import json
import os
import base64
import requests
import boto3
import uuid

CORS = {'Access-Control-Allow-Origin': '*'}
HF_SPACE = 'https://levihsu-ootdiffusion.hf.space'


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


def upload_to_space(cdn_url: str, hf_token: str) -> str:
    """Загружает изображение в HF Space через /upload."""
    img_bytes = requests.get(cdn_url, timeout=20).content
    resp = requests.post(
        f'{HF_SPACE}/upload',
        files={'files': ('image.jpg', img_bytes, 'image/jpeg')},
        headers={'Authorization': f'Bearer {hf_token}'},
        timeout=30,
    )
    if resp.status_code != 200:
        raise Exception(f'Upload failed ({resp.status_code}): {resp.text[:200]}')
    result = resp.json()
    if isinstance(result, list) and result:
        return result[0]
    raise Exception(f'Unexpected upload response: {result}')


def extract_image_url(data_item) -> str:
    """Извлекает CDN URL из ответа Gradio gallery."""
    if isinstance(data_item, list) and data_item:
        data_item = data_item[0]
    if isinstance(data_item, dict):
        img = data_item.get('image') or data_item
        if isinstance(img, dict):
            path = img.get('path') or img.get('url') or img.get('name') or ''
        else:
            path = str(img)
        if not path:
            path = data_item.get('path') or data_item.get('url') or data_item.get('name') or ''
        if path.startswith('http'):
            return path
        return f'{HF_SPACE}/file={path}'
    if isinstance(data_item, str):
        if data_item.startswith('http'):
            return data_item
        return f'{HF_SPACE}/file={data_item}'
    return ''


def run_tryon(human_path: str, garm_path: str, hf_category: str, hf_token: str) -> str:
    """
    Запускает примерку в HF Space и синхронно ждёт результата через SSE.
    Возвращает URL готового изображения.
    """
    session_hash = uuid.uuid4().hex[:10]

    join_payload = {
        'data': [
            human_path,
            garm_path,
            hf_category,
            1,    # n_samples
            20,   # n_steps
            2.0,  # image_scale
            -1,   # seed (random)
        ],
        'fn_index': 1,
        'session_hash': session_hash,
    }

    join_resp = requests.post(
        f'{HF_SPACE}/queue/join',
        json=join_payload,
        headers={'Authorization': f'Bearer {hf_token}'},
        timeout=30,
    )
    if join_resp.status_code != 200:
        raise Exception(f'queue/join error ({join_resp.status_code}): {join_resp.text[:300]}')

    # Читаем SSE-поток до завершения
    with requests.get(
        f'{HF_SPACE}/queue/data',
        params={'session_hash': session_hash},
        headers={
            'Authorization': f'Bearer {hf_token}',
            'Accept': 'text/event-stream',
        },
        stream=True,
        timeout=90,
    ) as sse:
        for raw_line in sse.iter_lines(decode_unicode=True):
            if not raw_line or not raw_line.startswith('data:'):
                continue
            try:
                evt = json.loads(raw_line[5:].strip())
                msg = evt.get('msg', '')
                if msg == 'process_completed':
                    output = evt.get('output', {}).get('data', [])
                    if not output:
                        raise Exception('Нейросеть вернула пустой результат')
                    return extract_image_url(output[0])
                elif msg == 'process_errored':
                    err = evt.get('output', {}).get('error', 'Ошибка генерации')
                    raise Exception(str(err))
            except json.JSONDecodeError:
                pass

    raise Exception('SSE поток завершился без результата')


def save_result_to_s3(result_url: str) -> str:
    """Скачивает результат из HF Space и сохраняет в S3."""
    img_bytes = requests.get(result_url, timeout=30).content
    file_key = f'tryon-results/{uuid.uuid4()}.jpg'
    s3 = s3_client()
    s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType='image/jpeg')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через HuggingFace OOTDiffusion.
    Синхронно ждёт результата нейросети и возвращает готовый URL.
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

    hf_token = os.environ.get('HF_TOKEN', '')
    if not hf_token:
        return {'statusCode': 500, 'headers': CORS,
                'body': json.dumps({'error': 'HF_TOKEN не настроен'})}

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    # ── Примерка (синхронная) ────────────────────────────────────────────────
    if action == 'run':
        model_b64 = body.get('model_image')
        garment_b64 = body.get('garment_image')
        category = body.get('category', 'tops')

        if not model_b64 or not garment_b64:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

        cat_map = {'tops': 'Upper-body', 'bottoms': 'Lower-body', 'one-pieces': 'Upper-body'}
        hf_category = cat_map.get(category, 'Upper-body')

        human_cdn = upload_base64_to_s3(model_b64, 'tryon-uploads/human')
        garm_cdn = upload_base64_to_s3(garment_b64, 'tryon-uploads/garment')

        human_path = upload_to_space(human_cdn, hf_token)
        garm_path = upload_to_space(garm_cdn, hf_token)

        hf_result_url = run_tryon(human_path, garm_path, hf_category, hf_token)
        final_url = save_result_to_s3(hf_result_url)

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'status': 'completed', 'result_url': final_url}),
        }

    # ── Сохранение копии ─────────────────────────────────────────────────────
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
