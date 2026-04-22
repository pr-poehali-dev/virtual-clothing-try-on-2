"""
Удаляет фон с изображения одежды через нейросеть remove.bg API.
Принимает base64-изображение, возвращает PNG с прозрачным фоном.
"""
import os
import json
import base64
import urllib.request
import urllib.error


def handler(event: dict, context) -> dict:
    """Удаляет фон с фото одежды через remove.bg. Принимает base64 image, отдаёт PNG без фона."""
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
    }

    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    if event.get('httpMethod') != 'POST':
        return {'statusCode': 405, 'headers': headers, 'body': json.dumps({'error': 'Method not allowed'})}

    api_key = os.environ.get('REMOVE_BG_API_KEY', '')
    if not api_key:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': 'API key not configured'})}

    body = json.loads(event.get('body') or '{}')
    image_b64 = body.get('image', '')

    if not image_b64:
        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'No image provided'})}

    # Убираем data URL префикс если есть
    if ',' in image_b64:
        image_b64 = image_b64.split(',')[1]

    image_bytes = base64.b64decode(image_b64)

    # Отправляем в remove.bg API (multipart/form-data вручную)
    boundary = '----FormBoundary7MA4YWxkTrZu0gW'
    body_parts = []
    body_parts.append(f'--{boundary}\r\n'.encode())
    body_parts.append(b'Content-Disposition: form-data; name="size"\r\n\r\nauto\r\n')
    body_parts.append(f'--{boundary}\r\n'.encode())
    body_parts.append(b'Content-Disposition: form-data; name="image_file"; filename="image.png"\r\n')
    body_parts.append(b'Content-Type: image/png\r\n\r\n')
    body_parts.append(image_bytes)
    body_parts.append(b'\r\n')
    body_parts.append(f'--{boundary}--\r\n'.encode())
    request_body = b''.join(body_parts)

    req = urllib.request.Request(
        'https://api.remove.bg/v1.0/removebg',
        data=request_body,
        headers={
            'X-Api-Key': api_key,
            'Content-Type': f'multipart/form-data; boundary={boundary}',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            png_bytes = resp.read()
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        return {
            'statusCode': 502,
            'headers': headers,
            'body': json.dumps({'error': f'remove.bg error {e.code}: {err_body}', 'ok': False})
        }

    result_b64 = base64.b64encode(png_bytes).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({
            'image': f'data:image/png;base64,{result_b64}',
            'ok': True,
        })
    }
