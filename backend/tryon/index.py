import json
import os
import base64
import requests
import boto3
import uuid

CORS = {'Access-Control-Allow-Origin': '*'}

# Бесплатный публичный HuggingFace Space с IDM-VTON
HF_SPACE_URL = 'https://yisol-idm-vton.hf.space'


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


def upload_url_to_space(image_url: str) -> str:
    """Загружает изображение по URL в HF Space, возвращает путь файла."""
    img_resp = requests.get(image_url, timeout=20)
    files = {'files': ('image.jpg', img_resp.content, 'image/jpeg')}
    upload_resp = requests.post(f'{HF_SPACE_URL}/upload', files=files, timeout=30)
    upload_data = upload_resp.json()
    if isinstance(upload_data, list):
        return upload_data[0]
    return upload_data


def get_result_url(result_file) -> str:
    """Извлекает URL из результата Gradio."""
    if isinstance(result_file, dict):
        path = result_file.get('path') or result_file.get('url') or result_file.get('name', '')
        if path.startswith('http'):
            return path
        return f'{HF_SPACE_URL}/file={path}'
    if isinstance(result_file, str):
        if result_file.startswith('http'):
            return result_file
        return f'{HF_SPACE_URL}/file={result_file}'
    return ''


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через бесплатный HuggingFace Space IDM-VTON.
    Загружает фото в S3, вызывает Gradio API, возвращает результат.
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

        # Загружаем оба фото в S3
        human_cdn = upload_base64_to_s3(model_image_b64, 'tryon-uploads/human')
        garm_cdn = upload_base64_to_s3(garment_image_b64, 'tryon-uploads/garment')

        # Загружаем файлы в HF Space
        human_path = upload_url_to_space(human_cdn)
        garm_path = upload_url_to_space(garm_cdn)

        desc_map = {
            'tops': 'shirt or top clothing garment',
            'bottoms': 'pants or skirt clothing garment',
            'one-pieces': 'dress clothing garment',
        }
        garment_desc = desc_map.get(category, 'clothing garment')

        session_hash = uuid.uuid4().hex[:8]

        # Gradio queue/join
        join_payload = {
            'data': [
                {'background': human_path, 'layers': [], 'composite': None},
                garm_path,
                garment_desc,
                True,   # is_checked
                False,  # is_checked_crop
                30,     # denoise_steps
                42,     # seed
            ],
            'fn_index': 0,
            'session_hash': session_hash,
        }

        join_resp = requests.post(
            f'{HF_SPACE_URL}/queue/join',
            json=join_payload,
            timeout=30,
        )

        if join_resp.status_code != 200:
            return {
                'statusCode': 500,
                'headers': CORS,
                'body': json.dumps({'error': f'Space недоступен ({join_resp.status_code}): {join_resp.text[:300]}'}),
            }

        join_data = join_resp.json()
        event_id = join_data.get('event_id', session_hash)

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'id': event_id,
                'session_hash': session_hash,
                'status': 'processing',
            }),
        }

    # ── Проверка статуса ─────────────────────────────────────────────────────
    elif action == 'status':
        session_hash = body.get('session_hash') or body.get('id')
        if not session_hash:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужен session_hash'})}

        # Читаем SSE поток от Gradio (не stream — просто GET с таймаутом)
        data_resp = requests.get(
            f'{HF_SPACE_URL}/queue/data',
            params={'session_hash': session_hash},
            timeout=20,
            headers={'Accept': 'text/event-stream'},
        )

        text = data_resp.text
        result_url = None
        status = 'processing'
        error = None

        for line in text.split('\n'):
            line = line.strip()
            if not line.startswith('data:'):
                continue
            try:
                evt = json.loads(line[5:].strip())
                msg = evt.get('msg', '')
                if msg == 'process_completed':
                    output_data = evt.get('output', {}).get('data', [])
                    if output_data:
                        result_url = get_result_url(output_data[0])
                    status = 'completed'
                    break
                elif msg == 'process_errored':
                    error = evt.get('output', {}).get('error', 'Ошибка генерации')
                    status = 'failed'
                    break
            except Exception:
                pass

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'status': status, 'result_url': result_url, 'error': error}),
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
