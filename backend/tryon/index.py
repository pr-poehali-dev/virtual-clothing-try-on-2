import json
import os
import requests
import boto3
import uuid


CORS = {'Access-Control-Allow-Origin': '*'}

# Replicate IDM-VTON model
REPLICATE_MODEL = 'cuuupid/idm-vton:c871bb9b046607b680449ecbae55fd8c6d945e0a1948644bf2361b3d021d3ff4'


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка одежды через Replicate IDM-VTON.
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

    api_key = os.environ.get('REPLICATE_API_KEY', '')
    if not api_key:
        return {'statusCode': 500, 'headers': CORS, 'body': json.dumps({'error': 'REPLICATE_API_KEY не настроен'})}

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'Prefer': 'wait=5',
    }

    body = json.loads(event.get('body') or '{}')
    action = body.get('action', 'run')

    # Запуск задачи примерки
    if action == 'run':
        model_image = body.get('model_image')
        garment_image = body.get('garment_image')
        category = body.get('category', 'upper_body')

        if not model_image or not garment_image:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

        # Маппинг категорий
        cat_map = {'tops': 'upper_body', 'bottoms': 'lower_body', 'one-pieces': 'dresses'}
        garment_desc_map = {'tops': 'upper body clothing', 'bottoms': 'lower body clothing', 'one-pieces': 'a dress'}
        rep_category = cat_map.get(category, 'upper_body')
        garment_desc = garment_desc_map.get(category, 'upper body clothing')

        payload = {
            'version': REPLICATE_MODEL.split(':')[1],
            'input': {
                'human_img': model_image,
                'garm_img': garment_image,
                'garment_des': garment_desc,
                'category': rep_category,
                'is_checked': True,
                'is_checked_crop': False,
                'denoise_steps': 30,
                'seed': 42,
            },
        }

        resp = requests.post(
            'https://api.replicate.com/v1/predictions',
            headers=headers,
            json=payload,
            timeout=30,
        )

        data = resp.json()

        if resp.status_code not in (200, 201):
            return {
                'statusCode': resp.status_code,
                'headers': CORS,
                'body': json.dumps({'error': data.get('detail', str(data))}),
            }

        prediction_id = data.get('id')
        status = data.get('status', 'starting')
        output = data.get('output')

        # Если уже готово (Prefer: wait отработал)
        if status == 'succeeded' and output:
            result_url = output[0] if isinstance(output, list) else output
            return {
                'statusCode': 200,
                'headers': CORS,
                'body': json.dumps({'id': prediction_id, 'status': 'completed', 'result_url': result_url}),
            }

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
            f'https://api.replicate.com/v1/predictions/{prediction_id}',
            headers=headers,
            timeout=15,
        )

        data = resp.json()
        status = data.get('status')
        output = data.get('output')
        error = data.get('error')

        result_url = None
        if status == 'succeeded' and output:
            result_url = output[0] if isinstance(output, list) else output

        mapped_status = 'completed' if status == 'succeeded' else ('failed' if status == 'failed' else 'processing')

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({
                'status': mapped_status,
                'result_url': result_url,
                'error': error,
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
