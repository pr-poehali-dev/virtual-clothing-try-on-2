import json
import os
import base64
import time
import requests
import boto3
import uuid


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через fashn.ai API.
    Принимает base64 фото человека и одежды, возвращает URL результата.
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

    CORS = {'Access-Control-Allow-Origin': '*'}

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    fashn_key = os.environ.get('FASHN_API_KEY', '')
    if not fashn_key:
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': 'FASHN_API_KEY не настроен'})}

    headers = {
        'Authorization': f'Bearer {fashn_key}',
        'Content-Type': 'application/json',
    }

    # Запуск задачи примерки
    if action == 'run':
        model_image = body.get('model_image')  # base64 или URL
        garment_image = body.get('garment_image')  # base64 или URL
        category = body.get('category', 'tops')  # tops / bottoms / one-pieces

        if not model_image or not garment_image:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

        payload = {
            'model_image': model_image,
            'garment_image': garment_image,
            'category': category,
            'flat_lay': False,
            'nsfw_filter': True,
        }

        resp = requests.post(
            'https://api.fashn.ai/v1/run',
            headers=headers,
            json=payload,
            timeout=30,
        )

        if resp.status_code != 200:
            return {
                'statusCode': resp.status_code,
                'headers': CORS,
                'body': json.dumps({'error': f'fashn.ai ошибка: {resp.text}'}),
            }

        data = resp.json()
        prediction_id = data.get('id')

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'id': prediction_id, 'status': 'processing'}),
        }

    # Проверка статуса задачи
    elif action == 'status':
        prediction_id = body.get('id')
        if not prediction_id:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужен id'})}

        resp = requests.get(
            f'https://api.fashn.ai/v1/status/{prediction_id}',
            headers=headers,
            timeout=15,
        )

        if resp.status_code != 200:
            return {
                'statusCode': resp.status_code,
                'headers': CORS,
                'body': json.dumps({'error': f'fashn.ai ошибка: {resp.text}'}),
            }

        data = resp.json()
        status = data.get('status')
        output = data.get('output', [])

        result_url = None
        if status == 'completed' and output:
            result_url = output[0] if isinstance(output, list) else output

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'status': status,
                'result_url': result_url,
                'error': data.get('error'),
            }),
        }

    # Сохранение результата в S3
    elif action == 'save':
        image_url = body.get('image_url')
        if not image_url:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужен image_url'})}

        img_resp = requests.get(image_url, timeout=30)
        img_data = img_resp.content

        s3 = boto3.client(
            's3',
            endpoint_url='https://bucket.poehali.dev',
            aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
            aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
        )

        file_key = f'tryon-results/{uuid.uuid4()}.png'
        s3.put_object(
            Bucket='files',
            Key=file_key,
            Body=img_data,
            ContentType='image/png',
        )

        cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'saved_url': cdn_url}),
        }

    return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Неизвестный action'})}
