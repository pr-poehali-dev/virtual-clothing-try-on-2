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

REPLICATE_API = 'https://api.replicate.com/v1'
# IDM-VTON — специализированная модель виртуальной примерки одежды
# Сохраняет лицо, фигуру и позу человека, меняет только одежду
VTON_MODEL = 'cuuupid/idm-vton:c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4'


def s3_client():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )


def data_url_to_base64(data_url: str) -> str:
    if ',' in data_url:
        return data_url.split(',', 1)[1]
    return data_url


def upload_image_to_s3(img_bytes: bytes, folder: str, ext: str = 'png') -> str:
    file_key = f'{folder}/{uuid.uuid4()}.{ext}'
    s3 = s3_client()
    s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType=f'image/{ext}')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"


def upload_dataurl_to_s3(data_url: str, folder: str) -> str:
    header, b64data = data_url.split(',', 1)
    ext = 'png' if 'png' in header else 'jpg'
    img_bytes = base64.b64decode(b64data)
    return upload_image_to_s3(img_bytes, folder, ext)


def run_vton(model_image_url: str, garment_image_url: str, category: str, api_key: str) -> str:
    """
    Запускает IDM-VTON через Replicate.
    Модель сохраняет лицо, телосложение и позу человека,
    заменяя только одежду на указанную.
    Возвращает URL готового изображения.
    """
    cat_map = {
        'tops': 'upper_body',
        'bottoms': 'lower_body',
        'dresses': 'dresses',
        'upper_body': 'upper_body',
        'lower_body': 'lower_body',
    }
    garment_desc_map = {
        'upper_body': 'upper body clothing item',
        'lower_body': 'lower body clothing item',
        'dresses': 'dress or full body outfit',
    }
    vton_category = cat_map.get(category, 'upper_body')
    garment_desc = garment_desc_map.get(vton_category, 'clothing item')

    headers = {
        'Authorization': f'Token {api_key}',
        'Content-Type': 'application/json',
        'Prefer': 'wait',
    }

    payload = {
        'version': VTON_MODEL.split(':')[1],
        'input': {
            'human_img': model_image_url,
            'garm_img': garment_image_url,
            'garment_des': garment_desc,
            'category': vton_category,
            'is_checked': True,
            'is_checked_crop': False,
            'denoise_steps': 30,
            'seed': 42,
        },
    }

    print(f'[VTON] Starting IDM-VTON prediction, category={vton_category}')
    resp = requests.post(
        f'{REPLICATE_API}/predictions',
        json=payload,
        headers=headers,
        timeout=120,
    )
    print(f'[VTON] status={resp.status_code} body={resp.text[:500]}')

    if resp.status_code not in (200, 201):
        raise Exception(f'Replicate API ошибка ({resp.status_code}): {resp.text[:300]}')

    data = resp.json()

    # Если Prefer: wait не сработал — поллим вручную
    if data.get('status') not in ('succeeded', 'failed', 'canceled'):
        prediction_id = data['id']
        poll_url = f'{REPLICATE_API}/predictions/{prediction_id}'
        for attempt in range(60):
            time.sleep(3)
            poll_resp = requests.get(poll_url, headers=headers, timeout=15)
            data = poll_resp.json()
            print(f'[VTON] poll attempt={attempt} status={data.get("status")}')
            if data.get('status') in ('succeeded', 'failed', 'canceled'):
                break

    if data.get('status') == 'failed':
        raise Exception(f'IDM-VTON завершился с ошибкой: {data.get("error")}')

    output = data.get('output')
    if not output:
        raise Exception('IDM-VTON не вернул результат')

    result_url = output if isinstance(output, str) else output[0]

    # Сохраняем результат в S3
    img_bytes = requests.get(result_url, timeout=30).content
    cdn_url = upload_image_to_s3(img_bytes, 'tryon-results', 'jpg')
    return cdn_url


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через Replicate IDM-VTON.
    Сохраняет лицо, фигуру и позу человека — меняет только одежду.
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    api_key = os.environ.get('REPLICATE_API_KEY', '')
    if not api_key:
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'REPLICATE_API_KEY не настроен'}),
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

        # Загружаем оба изображения в S3, чтобы Replicate мог их скачать по URL
        model_url = upload_dataurl_to_s3(model_data, 'tryon-input')
        garment_url = upload_dataurl_to_s3(garment_data, 'tryon-input')

        result_url = run_vton(model_url, garment_url, category, api_key)

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
