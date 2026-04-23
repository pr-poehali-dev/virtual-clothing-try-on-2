import json
import os
import base64
import requests
import boto3
import uuid
import time

CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Id, X-Auth-Token, X-Session-Id',
}


def s3_client():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )


def upload_image_to_s3(img_bytes: bytes, folder: str, ext: str = 'jpg') -> str:
    file_key = f'{folder}/{uuid.uuid4()}.{ext}'
    s3 = s3_client()
    s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType=f'image/{ext}')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"


def dataurl_to_bytes(data_url: str) -> tuple:
    header, b64data = data_url.split(',', 1)
    ext = 'png' if 'png' in header else 'jpg'
    return base64.b64decode(b64data), ext


def run_vton(model_b64: str, garment_b64: str, category: str, hf_token: str) -> str:
    """
    Виртуальная примерка через HuggingFace Inference API.
    Модель: fashn/tryon — бесплатная, специализированная для одежды.
    """
    cat_map = {
        'tops': 'upper_body',
        'bottoms': 'lower_body',
        'dresses': 'dresses',
        'one-pieces': 'dresses',
        'upper_body': 'upper_body',
        'lower_body': 'lower_body',
    }
    vton_category = cat_map.get(category, 'upper_body')

    model_bytes, _ = dataurl_to_bytes(model_b64)
    garment_bytes, _ = dataurl_to_bytes(garment_b64)

    headers = {'Authorization': f'Bearer {hf_token}'}

    print(f'[VTON] Uploading to fashn/tryon, category={vton_category}')
    print(f'[VTON] model_size={len(model_bytes)} garment_size={len(garment_bytes)}')

    payload = {
        'inputs': {
            'model_image': base64.b64encode(model_bytes).decode(),
            'garment_image': base64.b64encode(garment_bytes).decode(),
            'category': vton_category,
        }
    }

    resp = requests.post(
        'https://api-inference.huggingface.co/models/fashn/tryon',
        headers=headers,
        json=payload,
        timeout=120,
    )

    print(f'[VTON] fashn/tryon status={resp.status_code} len={len(resp.content)}')

    if resp.status_code == 503:
        data = resp.json()
        wait = data.get('estimated_time', 20)
        print(f'[VTON] Model loading, waiting {wait}s')
        time.sleep(min(float(wait), 40))
        resp = requests.post(
            'https://api-inference.huggingface.co/models/fashn/tryon',
            headers=headers,
            json=payload,
            timeout=120,
        )
        print(f'[VTON] Retry status={resp.status_code}')

    if resp.status_code == 200:
        # Ответ — бинарное изображение
        if resp.content[:3] in (b'\xff\xd8\xff', b'\x89PN'):
            return upload_image_to_s3(resp.content, 'tryon-results', 'jpg')
        # Или JSON с URL
        try:
            data = resp.json()
            url = data.get('output') or data.get('result') or data.get('url')
            if url:
                img_bytes = requests.get(url, timeout=30).content
                return upload_image_to_s3(img_bytes, 'tryon-results', 'jpg')
        except Exception:
            pass
        if len(resp.content) > 1000:
            return upload_image_to_s3(resp.content, 'tryon-results', 'jpg')

    raise Exception(f'HuggingFace ошибка ({resp.status_code}): {resp.text[:300]}')


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через HuggingFace (бесплатно).
    Сохраняет лицо, фигуру и позу человека — меняет только одежду.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    hf_token = os.environ.get('HF_TOKEN', '')
    if not hf_token:
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'HF_TOKEN не настроен'}),
        }

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    if action == 'run':
        model_data = body.get('model_image')
        garment_data = body.get('garment_image')
        category = body.get('category', 'upper_body')

        if not model_data or not garment_data:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Нужны model_image и garment_image'}),
            }

        result_url = run_vton(model_data, garment_data, category, hf_token)

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'status': 'completed', 'result_url': result_url}),
        }

    elif action == 'save':
        image_url = body.get('image_url')
        if not image_url:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Нужен image_url'}),
            }
        img_bytes = requests.get(image_url, timeout=30).content
        cdn_url = upload_image_to_s3(img_bytes, 'tryon-history', 'jpg')
        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'saved_url': cdn_url}),
        }

    return {
        'statusCode': 400,
        'headers': {'Access-Control-Allow-Origin': '*'},
        'body': json.dumps({'error': f'Неизвестное действие: {action}'}),
    }
