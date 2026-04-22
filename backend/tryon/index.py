import json
import os
import base64
import requests
import boto3
import uuid
import time

CORS = {'Access-Control-Allow-Origin': '*'}
YANDEX_API_KEY = None  # берём из os.environ

# Endpoints Yandex AI Studio (совместимы с OpenAI API)
TEXT_API = 'https://llm.api.cloud.yandex.net/v1/chat/completions'
IMAGE_API = 'https://llm.api.cloud.yandex.net/foundationModels/v1/imageGenerationAsync'
OPERATION_API = 'https://llm.api.cloud.yandex.net/operations'


def s3_client():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )


def upload_base64_to_s3(data_url: str, folder: str) -> str:
    header, b64data = data_url.split(',', 1)
    ext = 'png' if 'png' in header else 'jpg'
    img_bytes = base64.b64decode(b64data)
    file_key = f'{folder}/{uuid.uuid4()}.{ext}'
    s3 = s3_client()
    s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType=f'image/{ext}')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"


def get_pure_base64(data_url: str) -> str:
    """Возвращает чистый base64 без data:image/...;base64, префикса."""
    if ',' in data_url:
        return data_url.split(',', 1)[1]
    return data_url


def describe_and_generate(model_b64: str, garment_b64: str, category: str, api_key: str) -> str:
    """
    Шаг 1: Gemma 3 27B смотрит на фото человека и одежды,
            составляет точный промпт для генерации.
    Шаг 2: YandexART генерирует итоговое изображение по промпту.
    Возвращает URL готового изображения.
    """
    headers = {
        'Authorization': f'Api-Key {api_key}',
        'Content-Type': 'application/json',
    }

    # ── Шаг 1: анализ двух фото через Gemma 3 27B ─────────────────────────
    text_payload = {
        'model': 'gpt://b1gtcbrqbbp2v3nf30eu/gemma-3-27b-it',
        'messages': [
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'text',
                        'text': (
                            'Ты помогаешь создать промпт для нейросети виртуальной примерки одежды.\n'
                            'Первое изображение — человек (модель). Второе изображение — одежда.\n\n'
                            'Опиши подробно:\n'
                            '1. Внешность человека: пол, телосложение, цвет волос, цвет кожи, поза\n'
                            '2. Одежду: тип, цвет, фасон, материал, детали\n\n'
                            'Затем напиши финальный промпт на английском языке для YandexART:\n'
                            '"A photo of [описание человека] wearing [описание одежды], '
                            'studio lighting, fashion photography, high quality, realistic"\n\n'
                            'Верни ТОЛЬКО финальный промпт на английском, без объяснений.'
                        ),
                    },
                    {
                        'type': 'image_url',
                        'image_url': {
                            'url': f'data:image/jpeg;base64,{get_pure_base64(model_b64)}'
                        },
                    },
                    {
                        'type': 'image_url',
                        'image_url': {
                            'url': f'data:image/jpeg;base64,{get_pure_base64(garment_b64)}'
                        },
                    },
                ],
            }
        ],
        'max_tokens': 300,
    }

    print('[STEP 1] Calling Gemma 3 27B for prompt generation...')
    text_resp = requests.post(TEXT_API, json=text_payload, headers=headers, timeout=30)
    print(f'[STEP 1] status={text_resp.status_code} body={text_resp.text[:400]}')

    if text_resp.status_code != 200:
        raise Exception(f'Gemma API ошибка ({text_resp.status_code}): {text_resp.text[:300]}')

    text_data = text_resp.json()
    art_prompt = text_data['choices'][0]['message']['content'].strip()
    print(f'[STEP 1] Generated prompt: {art_prompt}')

    # ── Шаг 2: генерация через YandexART ──────────────────────────────────
    image_payload = {
        'modelUri': 'art://b1gtcbrqbbp2v3nf30eu/yandex-art/latest',
        'generationOptions': {
            'seed': str(int(time.time()) % 10000),
            'aspectRatio': {'widthRatio': '3', 'heightRatio': '4'},
        },
        'messages': [
            {'weight': '1', 'text': art_prompt}
        ],
    }

    print('[STEP 2] Calling YandexART...')
    img_resp = requests.post(IMAGE_API, json=image_payload, headers=headers, timeout=30)
    print(f'[STEP 2] status={img_resp.status_code} body={img_resp.text[:400]}')

    if img_resp.status_code != 200:
        raise Exception(f'YandexART ошибка ({img_resp.status_code}): {img_resp.text[:300]}')

    operation_id = img_resp.json().get('id')
    if not operation_id:
        raise Exception(f'Не получен operation_id: {img_resp.text[:200]}')

    # ── Шаг 3: ждём результата операции ───────────────────────────────────
    for attempt in range(30):
        time.sleep(3)
        op_resp = requests.get(
            f'{OPERATION_API}/{operation_id}',
            headers=headers,
            timeout=15,
        )
        op_data = op_resp.json()
        print(f'[STEP 3] attempt={attempt} done={op_data.get("done")}')

        if op_data.get('done'):
            if 'error' in op_data:
                raise Exception(f'YandexART error: {op_data["error"]}')
            img_b64 = op_data['response']['image']
            # Сохраняем в S3
            img_bytes = base64.b64decode(img_b64)
            file_key = f'tryon-results/{uuid.uuid4()}.jpeg'
            s3 = s3_client()
            s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType='image/jpeg')
            return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"

    raise Exception('YandexART: превышено время ожидания генерации')


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка через Yandex AI:
    1. Gemma 3 27B анализирует фото человека и одежды, составляет промпт
    2. YandexART генерирует финальное изображение по промпту
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

    api_key = os.environ.get('YANDEX_API_KEY', '')
    if not api_key:
        return {'statusCode': 500, 'headers': CORS,
                'body': json.dumps({'error': 'YANDEX_API_KEY не настроен'})}

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    if action == 'run':
        model_b64 = body.get('model_image')
        garment_b64 = body.get('garment_image')
        category = body.get('category', 'tops')

        if not model_b64 or not garment_b64:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

        result_url = describe_and_generate(model_b64, garment_b64, category, api_key)

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'status': 'completed', 'result_url': result_url}),
        }

    elif action == 'save':
        image_url = body.get('image_url')
        if not image_url:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Нужен image_url'})}
        img_bytes = requests.get(image_url, timeout=30).content
        file_key = f'tryon-history/{uuid.uuid4()}.jpg'
        s3 = s3_client()
        s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType='image/jpeg')
        cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"
        return {'statusCode': 200, 'headers': CORS,
                'body': json.dumps({'saved_url': cdn_url})}

    return {'statusCode': 400, 'headers': CORS,
            'body': json.dumps({'error': 'Неизвестный action'})}
