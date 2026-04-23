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

SPACE_URL = 'https://levihsu-ootdiffusion.hf.space'


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


def upload_to_space(img_bytes: bytes, ext: str, hf_token: str) -> str:
    headers = {'Authorization': f'Bearer {hf_token}'}
    resp = requests.post(
        f'{SPACE_URL}/upload',
        headers=headers,
        files={'files': (f'image.{ext}', img_bytes, f'image/{ext}')},
        timeout=30,
    )
    print(f'[VTON] upload status={resp.status_code} body={resp.text[:200]}')
    if resp.status_code != 200:
        raise Exception(f'Upload failed ({resp.status_code}): {resp.text[:200]}')
    paths = resp.json()
    return paths[0] if isinstance(paths, list) else paths


def run_vton(model_b64: str, garment_b64: str, category: str, hf_token: str) -> str:
    """
    Виртуальная примерка через OOTDiffusion HuggingFace Space (бесплатно).
    Использует Gradio queue API для надёжной работы с длинными задачами.
    """
    cat_map = {
        'tops': 'Upper-body',
        'upper_body': 'Upper-body',
        'bottoms': 'Lower-body',
        'lower_body': 'Lower-body',
        'dresses': 'Dress',
        'one-pieces': 'Dress',
    }
    vton_category = cat_map.get(category, 'Upper-body')

    model_bytes, model_ext = dataurl_to_bytes(model_b64)
    garment_bytes, garment_ext = dataurl_to_bytes(garment_b64)

    print(f'[VTON] category={vton_category} model={len(model_bytes)}b garment={len(garment_bytes)}b')

    headers = {'Authorization': f'Bearer {hf_token}'}

    # Загружаем изображения
    model_path = upload_to_space(model_bytes, model_ext, hf_token)
    garment_path = upload_to_space(garment_bytes, garment_ext, hf_token)
    print(f'[VTON] model_path={model_path} garment_path={garment_path}')

    # Ставим задачу в очередь через Gradio queue/join
    join_payload = {
        'fn_index': 1,  # process_dc
        'data': [
            {'path': model_path, 'orig_name': f'model.{model_ext}'},
            {'path': garment_path, 'orig_name': f'garment.{garment_ext}'},
            1,    # n_samples
            20,   # n_steps
            2.0,  # image_scale
            42,   # seed
            vton_category,
        ],
        'session_hash': uuid.uuid4().hex,
    }

    join_resp = requests.post(
        f'{SPACE_URL}/queue/join',
        headers={**headers, 'Content-Type': 'application/json'},
        json=join_payload,
        timeout=30,
    )
    print(f'[VTON] queue/join status={join_resp.status_code} body={join_resp.text[:200]}')

    if join_resp.status_code != 200:
        raise Exception(f'queue/join failed ({join_resp.status_code}): {join_resp.text[:200]}')

    event_id = join_resp.json().get('event_id')
    print(f'[VTON] event_id={event_id}')

    # Поллим результат через queue/data
    session_hash = join_payload['session_hash']
    for attempt in range(40):
        time.sleep(3)
        data_resp = requests.get(
            f'{SPACE_URL}/queue/data',
            headers=headers,
            params={'session_hash': session_hash},
            timeout=30,
            stream=True,
        )
        print(f'[VTON] poll attempt={attempt} status={data_resp.status_code}')

        if data_resp.status_code != 200:
            continue

        # SSE stream — читаем построчно
        for raw_line in data_resp.iter_lines():
            if not raw_line:
                continue
            line = raw_line.decode('utf-8') if isinstance(raw_line, bytes) else raw_line
            if not line.startswith('data:'):
                continue
            try:
                msg = json.loads(line[5:].strip())
            except Exception:
                continue

            msg_type = msg.get('msg')
            print(f'[VTON] SSE msg={msg_type}')

            if msg_type == 'process_completed':
                output = msg.get('output', {})
                gallery = output.get('data', [[]])[0]
                print(f'[VTON] gallery={str(gallery)[:200]}')

                if isinstance(gallery, list) and len(gallery) > 0:
                    first = gallery[0]
                    if isinstance(first, dict):
                        result_url = first.get('url') or first.get('path') or ''
                    else:
                        result_url = str(first)
                elif isinstance(gallery, dict):
                    result_url = gallery.get('url') or gallery.get('path') or ''
                else:
                    result_url = str(gallery)

                if not result_url:
                    raise Exception('Пустой URL результата')

                if not result_url.startswith('http'):
                    result_url = f'{SPACE_URL}/file={result_url}'

                print(f'[VTON] downloading result from {result_url}')
                img_resp = requests.get(result_url, headers=headers, timeout=30)
                return upload_image_to_s3(img_resp.content, 'tryon-results', 'jpg')

            if msg_type == 'process_generating':
                break  # ещё генерируется, продолжаем поллить

            if msg_type in ('queue_full', 'error'):
                raise Exception(f'Space вернул ошибку: {msg}')

    raise Exception('Превышено время ожидания ответа от OOTDiffusion')


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через OOTDiffusion (бесплатно).
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
        category = body.get('category', 'tops')

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
