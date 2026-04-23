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

HF_API = 'https://api-inference.huggingface.co/models'
# Nymbo Virtual Try-On — стабильная модель на HF Inference API
VTON_MODEL = 'Nymbo/Virtual-Try-On'


def s3_client():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )


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


def dataurl_to_bytes(data_url: str) -> tuple[bytes, str]:
    header, b64data = data_url.split(',', 1)
    ext = 'png' if 'png' in header else 'jpg'
    return base64.b64decode(b64data), ext


def run_vton_hf(model_image_b64: str, garment_image_b64: str, category: str, hf_token: str) -> str:
    """
    Виртуальная примерка через HuggingFace Inference API.
    Использует модель Nymbo/Virtual-Try-On — бесплатно.
    """
    model_bytes, _ = dataurl_to_bytes(model_image_b64)
    garment_bytes, _ = dataurl_to_bytes(garment_image_b64)

    headers = {
        'Authorization': f'Bearer {hf_token}',
        'Content-Type': 'application/json',
    }

    cat_map = {
        'tops': 'upper_body',
        'bottoms': 'lower_body',
        'dresses': 'dresses',
        'one-pieces': 'dresses',
        'upper_body': 'upper_body',
        'lower_body': 'lower_body',
    }
    vton_category = cat_map.get(category, 'upper_body')

    payload = {
        'inputs': {
            'background': base64.b64encode(model_bytes).decode(),
            'layers': [base64.b64encode(garment_bytes).decode()],
        },
        'parameters': {
            'category': vton_category,
        }
    }

    print(f'[VTON-HF] Sending request to {VTON_MODEL}, category={vton_category}')

    # Retry до 5 раз — модель может быть на загрузке
    for attempt in range(5):
        resp = requests.post(
            f'{HF_API}/{VTON_MODEL}',
            headers=headers,
            json=payload,
            timeout=120,
        )
        print(f'[VTON-HF] attempt={attempt} status={resp.status_code}')

        if resp.status_code == 503:
            wait = resp.json().get('estimated_time', 20)
            print(f'[VTON-HF] Model loading, waiting {wait}s...')
            time.sleep(min(float(wait), 30))
            continue

        if resp.status_code == 200:
            img_bytes = resp.content
            cdn_url = upload_image_to_s3(img_bytes, 'tryon-results', 'jpg')
            return cdn_url

        raise Exception(f'HuggingFace API ошибка ({resp.status_code}): {resp.text[:300]}')

    raise Exception('Модель на HuggingFace не отвечает, попробуй чуть позже')


def run_vton_gradio(model_image_b64: str, garment_image_b64: str, category: str, hf_token: str) -> str:
    """
    Виртуальная примерка через HuggingFace Space (Gradio API).
    Fallback если Inference API не работает.
    """
    SPACE_URL = 'https://nymbo-virtual-try-on.hf.space'

    model_bytes, model_ext = dataurl_to_bytes(model_image_b64)
    garment_bytes, garment_ext = dataurl_to_bytes(garment_image_b64)

    headers = {'Authorization': f'Bearer {hf_token}'}

    cat_map = {
        'tops': 'Upper body',
        'bottoms': 'Lower body',
        'dresses': 'Dress',
        'one-pieces': 'Dress',
        'upper_body': 'Upper body',
        'lower_body': 'Lower body',
        'dresses_cat': 'Dress',
    }
    vton_category = cat_map.get(category, 'Upper body')

    print(f'[VTON-Gradio] Using Space {SPACE_URL}, category={vton_category}')

    # Загружаем изображения в Space
    def upload_to_space(img_bytes: bytes, ext: str) -> str:
        upload_resp = requests.post(
            f'{SPACE_URL}/upload',
            headers=headers,
            files={'files': (f'image.{ext}', img_bytes, f'image/{ext}')},
            timeout=60,
        )
        if upload_resp.status_code != 200:
            raise Exception(f'Upload failed: {upload_resp.text[:200]}')
        return upload_resp.json()[0]

    model_path = upload_to_space(model_bytes, model_ext)
    garment_path = upload_to_space(garment_bytes, garment_ext)

    # Запускаем предсказание через Gradio API
    predict_payload = {
        'data': [
            {'path': model_path},
            {'path': garment_path},
            vton_category,
            True,   # is_checked
            True,   # is_checked_crop
            30,     # denoise_steps
            42,     # seed
        ]
    }

    predict_resp = requests.post(
        f'{SPACE_URL}/api/predict',
        headers={**headers, 'Content-Type': 'application/json'},
        json=predict_payload,
        timeout=120,
    )
    print(f'[VTON-Gradio] predict status={predict_resp.status_code}')

    if predict_resp.status_code != 200:
        raise Exception(f'Gradio predict ошибка ({predict_resp.status_code}): {predict_resp.text[:300]}')

    result_data = predict_resp.json()
    output = result_data.get('data', [{}])[0]
    result_url = output.get('url') or output.get('path', '')

    if not result_url:
        raise Exception('Gradio не вернул результат')

    if not result_url.startswith('http'):
        result_url = f'{SPACE_URL}/file={result_url}'

    img_bytes = requests.get(result_url, headers=headers, timeout=30).content
    cdn_url = upload_image_to_s3(img_bytes, 'tryon-results', 'jpg')
    return cdn_url


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

        try:
            result_url = run_vton_gradio(model_data, garment_data, category, hf_token)
        except Exception as e:
            print(f'[VTON] Gradio failed: {e}, trying Inference API...')
            result_url = run_vton_hf(model_data, garment_data, category, hf_token)

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
