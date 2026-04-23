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
    if resp.status_code != 200:
        raise Exception(f'Upload failed ({resp.status_code}): {resp.text[:200]}')
    paths = resp.json()
    return paths[0] if isinstance(paths, list) else paths


def action_start(body: dict, hf_token: str) -> dict:
    """Загружает фото в Space и ставит задачу в очередь, возвращает session_hash."""
    model_data = body.get('model_image')
    garment_data = body.get('garment_image')
    category = body.get('category', 'tops')

    if not model_data or not garment_data:
        return {'statusCode': 400, 'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

    cat_map = {
        'tops': 'Upper-body', 'upper_body': 'Upper-body',
        'bottoms': 'Lower-body', 'lower_body': 'Lower-body',
        'dresses': 'Dress', 'one-pieces': 'Dress',
    }
    vton_category = cat_map.get(category, 'Upper-body')

    model_bytes, model_ext = dataurl_to_bytes(model_data)
    garment_bytes, garment_ext = dataurl_to_bytes(garment_data)

    print(f'[VTON] start category={vton_category} model={len(model_bytes)}b garment={len(garment_bytes)}b')

    model_path = upload_to_space(model_bytes, model_ext, hf_token)
    garment_path = upload_to_space(garment_bytes, garment_ext, hf_token)
    print(f'[VTON] uploaded model={model_path} garment={garment_path}')

    session_hash = uuid.uuid4().hex

    join_payload = {
        'fn_index': 0,  # process_hd
        'data': [
            {'path': model_path, 'orig_name': f'model.{model_ext}'},
            {'path': garment_path, 'orig_name': f'garment.{garment_ext}'},
            1, 20, 2.0, 42,
        ],
        'session_hash': session_hash,
    }

    headers = {'Authorization': f'Bearer {hf_token}', 'Content-Type': 'application/json'}
    join_resp = requests.post(f'{SPACE_URL}/queue/join', headers=headers, json=join_payload, timeout=15)
    print(f'[VTON] queue/join status={join_resp.status_code} body={join_resp.text[:200]}')

    if join_resp.status_code != 200:
        raise Exception(f'queue/join failed ({join_resp.status_code}): {join_resp.text[:200]}')

    event_id = join_resp.json().get('event_id')
    return {
        'statusCode': 200,
        'body': json.dumps({'status': 'processing', 'session_hash': session_hash, 'event_id': event_id}),
    }


def action_status(body: dict, hf_token: str) -> dict:
    """Проверяет статус задачи по session_hash, возвращает результат если готово."""
    session_hash = body.get('session_hash')
    if not session_hash:
        return {'statusCode': 400, 'body': json.dumps({'error': 'Нужен session_hash'})}

    headers = {'Authorization': f'Bearer {hf_token}'}

    data_resp = requests.get(
        f'{SPACE_URL}/queue/data',
        headers=headers,
        params={'session_hash': session_hash},
        timeout=15,
        stream=True,
    )
    print(f'[VTON] poll session={session_hash} status={data_resp.status_code}')

    if data_resp.status_code != 200:
        return {'statusCode': 200, 'body': json.dumps({'status': 'processing'})}

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
            all_data = output.get('data', [])
            print(f'[VTON] output data={str(all_data)[:400]}')

            # Ищем URL/путь к изображению
            result_url = ''
            for item in all_data:
                if isinstance(item, list):
                    for sub in item:
                        if isinstance(sub, dict):
                            result_url = sub.get('url') or sub.get('path') or ''
                        elif isinstance(sub, str) and sub:
                            result_url = sub
                        if result_url:
                            break
                elif isinstance(item, dict):
                    result_url = item.get('url') or item.get('path') or ''
                elif isinstance(item, str) and item:
                    result_url = item
                if result_url:
                    break

            print(f'[VTON] result_url={result_url}')

            if not result_url:
                return {'statusCode': 500, 'body': json.dumps({'error': f'Space вернул пустой результат: {str(all_data)[:200]}'})}

            if not result_url.startswith('http'):
                result_url = f'{SPACE_URL}/file={result_url}'

            img_bytes = requests.get(result_url, headers=headers, timeout=30).content
            cdn_url = upload_image_to_s3(img_bytes, 'tryon-results', 'jpg')
            return {'statusCode': 200, 'body': json.dumps({'status': 'completed', 'result_url': cdn_url})}

        if msg_type in ('queue_full', 'error'):
            err = msg.get('message') or str(msg)
            return {'statusCode': 500, 'body': json.dumps({'error': f'Space ошибка: {err}'})}

    return {'statusCode': 200, 'body': json.dumps({'status': 'processing'})}


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка через OOTDiffusion (бесплатно).
    action=start — загружает фото, ставит в очередь, возвращает session_hash
    action=status — проверяет готовность по session_hash
    action=save — сохраняет результат в историю
    """
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS, 'body': ''}

    hf_token = os.environ.get('HF_TOKEN', '')
    if not hf_token:
        return {'statusCode': 500, 'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'HF_TOKEN не настроен'})}

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    try:
        if action in ('run', 'start'):
            result = action_start(body, hf_token)
        elif action == 'status':
            result = action_status(body, hf_token)
        elif action == 'save':
            image_url = body.get('image_url')
            if not image_url:
                result = {'statusCode': 400, 'body': json.dumps({'error': 'Нужен image_url'})}
            else:
                img_bytes = requests.get(image_url, timeout=30).content
                cdn_url = upload_image_to_s3(img_bytes, 'tryon-history', 'jpg')
                result = {'statusCode': 200, 'body': json.dumps({'saved_url': cdn_url})}
        else:
            result = {'statusCode': 400, 'body': json.dumps({'error': f'Неизвестное действие: {action}'})}
    except Exception as e:
        print(f'[VTON] ERROR: {e}')
        result = {'statusCode': 500, 'body': json.dumps({'error': str(e)})}

    result['headers'] = {'Access-Control-Allow-Origin': '*'}
    return result
