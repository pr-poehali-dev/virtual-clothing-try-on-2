import json
import os
import base64
import requests
import boto3
import uuid

CORS = {'Access-Control-Allow-Origin': '*'}
FAL_TRYON_URL = 'https://fal.run/fal-ai/idm-vton'


def s3_client():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )


def upload_base64_to_s3(data_url: str, folder: str) -> str:
    """Загружает base64 изображение в S3, возвращает публичный CDN URL."""
    header, b64data = data_url.split(',', 1)
    ext = 'png' if 'png' in header else 'jpg'
    img_bytes = base64.b64decode(b64data)
    file_key = f'{folder}/{uuid.uuid4()}.{ext}'
    s3 = s3_client()
    s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType=f'image/{ext}')
    cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"
    return cdn_url


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через fal.ai IDM-VTON.
    Загружает фото в S3, вызывает fal.ai, возвращает результат.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
                'Access-Control-Max-Age': '86400',
            },
            'body': '',
        }

    fal_key = os.environ.get('FAL_API_KEY', '')
    if not fal_key:
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': 'FAL_API_KEY не настроен'})}

    fal_headers = {
        'Authorization': f'Key {fal_key}',
        'Content-Type': 'application/json',
    }

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    # ── Запуск примерки ──────────────────────────────────────────────────────
    if action == 'run':
        model_image_b64 = body.get('model_image')
        garment_image_b64 = body.get('garment_image')
        category = body.get('category', 'tops')

        if not model_image_b64 or not garment_image_b64:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

        # Загружаем оба фото в S3 — получаем публичные URL
        human_url = upload_base64_to_s3(model_image_b64, 'tryon-uploads/human')
        garm_url = upload_base64_to_s3(garment_image_b64, 'tryon-uploads/garment')

        desc_map = {
            'tops': 'shirt or top clothing garment',
            'bottoms': 'pants or skirt clothing garment',
            'one-pieces': 'dress clothing garment',
        }
        garment_desc = desc_map.get(category, 'clothing garment')

        payload = {
            'human_image_url': human_url,
            'garment_image_url': garm_url,
            'garment_description': garment_desc,
        }

        resp = requests.post(
            FAL_TRYON_URL,
            headers=fal_headers,
            json=payload,
            timeout=120,
        )

        data = resp.json()

        if resp.status_code != 200:
            err = data.get('detail') or data.get('error') or str(data)
            return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': f'fal.ai: {err}'})}

        # fal.ai возвращает результат сразу (синхронно)
        # Структура: {"image": {"url": "...", "width": ..., "height": ...}}
        image = data.get('image') or {}
        result_url = image.get('url') or ''

        if not result_url:
            # Альтернативная структура
            result_url = data.get('output', {}).get('image', {}).get('url', '') if isinstance(data.get('output'), dict) else ''

        if not result_url:
            return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': 'fal.ai не вернул результат', 'raw': str(data)[:300]})}

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'status': 'completed', 'result_url': result_url}),
        }

    # ── Сохранение в S3 ──────────────────────────────────────────────────────
    elif action == 'save':
        image_url = body.get('image_url')
        if not image_url:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужен image_url'})}

        img_resp = requests.get(image_url, timeout=30)
        s3 = s3_client()
        file_key = f'tryon-results/{uuid.uuid4()}.png'
        s3.put_object(Bucket='files', Key=file_key, Body=img_resp.content, ContentType='image/png')
        cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'saved_url': cdn_url})}

    return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Неизвестный action'})}
