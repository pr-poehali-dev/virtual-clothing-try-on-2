import json
import os
import base64
import requests
import boto3
import uuid
from PIL import Image, ImageFilter, ImageEnhance
import io

CORS = {'Access-Control-Allow-Origin': '*'}


def s3_client():
    return boto3.client(
        's3',
        endpoint_url='https://bucket.poehali.dev',
        aws_access_key_id=os.environ['AWS_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['AWS_SECRET_ACCESS_KEY'],
    )


def decode_base64_image(data_url: str) -> Image.Image:
    """Декодирует base64 строку в PIL Image."""
    header, b64data = data_url.split(',', 1)
    img_bytes = base64.b64decode(b64data)
    return Image.open(io.BytesIO(img_bytes)).convert('RGBA')


def remove_background(image: Image.Image, api_key: str) -> Image.Image:
    """Убирает фон с изображения через remove.bg API."""
    buf = io.BytesIO()
    image.convert('RGB').save(buf, format='JPEG', quality=90)
    buf.seek(0)

    resp = requests.post(
        'https://api.remove.bg/v1.0/removebg',
        files={'image_file': ('image.jpg', buf, 'image/jpeg')},
        data={'size': 'auto'},
        headers={'X-Api-Key': api_key},
        timeout=30,
    )

    if resp.status_code != 200:
        raise Exception(f'remove.bg ошибка: {resp.text[:200]}')

    return Image.open(io.BytesIO(resp.content)).convert('RGBA')


def find_garment_bbox(garment: Image.Image):
    """Находит bounding box непрозрачных пикселей одежды."""
    alpha = garment.split()[3]
    bbox = alpha.getbbox()
    return bbox or (0, 0, garment.width, garment.height)


def find_body_region(person: Image.Image, category: str):
    """
    Грубо определяет область тела для наложения одежды.
    Возвращает (x, y, w, h) — куда поместить одежду.
    """
    pw, ph = person.size

    if category == 'tops':
        # Верхняя часть тела: ~от 15% до 60% высоты, по центру
        y = int(ph * 0.13)
        h = int(ph * 0.47)
        w = int(pw * 0.85)
        x = int((pw - w) / 2)
    elif category == 'bottoms':
        # Нижняя часть: ~от 52% до 90% высоты
        y = int(ph * 0.50)
        h = int(ph * 0.42)
        w = int(pw * 0.70)
        x = int((pw - w) / 2)
    else:  # one-pieces / dress
        # Почти всё тело: ~от 13% до 88%
        y = int(ph * 0.13)
        h = int(ph * 0.75)
        w = int(pw * 0.85)
        x = int((pw - w) / 2)

    return x, y, w, h


def composite_outfit(person: Image.Image, garment_nobg: Image.Image, category: str) -> Image.Image:
    """Накладывает одежду на фото человека с умным позиционированием."""
    result = person.convert('RGBA').copy()
    pw, ph = result.size

    # Область для наложения
    tx, ty, tw, th = find_body_region(person, category)

    # Обрезаем одежду до bounding box непрозрачных пикселей
    bbox = find_garment_bbox(garment_nobg)
    garment_crop = garment_nobg.crop(bbox)

    # Масштабируем одежду в целевую область с сохранением пропорций
    gw, gh = garment_crop.size
    scale = min(tw / gw, th / gh)
    new_gw = int(gw * scale)
    new_gh = int(gh * scale)
    garment_resized = garment_crop.resize((new_gw, new_gh), Image.LANCZOS)

    # Центрируем в области
    paste_x = tx + (tw - new_gw) // 2
    paste_y = ty + (th - new_gh) // 2

    # Слегка размываем края одежды для плавного вхождения
    alpha = garment_resized.split()[3]
    alpha_blurred = alpha.filter(ImageFilter.GaussianBlur(radius=2))
    garment_resized.putalpha(alpha_blurred)

    # Немного усиливаем насыщенность одежды чтобы выглядело естественнее
    enhancer = ImageEnhance.Color(garment_resized)
    garment_resized = enhancer.enhance(1.05)

    result.paste(garment_resized, (paste_x, paste_y), garment_resized.split()[3])

    return result.convert('RGB')


def save_image_to_s3(img: Image.Image) -> str:
    """Сохраняет PIL Image в S3 и возвращает CDN URL."""
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=92)
    buf.seek(0)

    s3 = s3_client()
    file_key = f'tryon-results/{uuid.uuid4()}.jpg'
    s3.put_object(Bucket='files', Key=file_key, Body=buf.getvalue(), ContentType='image/jpeg')
    return f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"


def handler(event: dict, context) -> dict:
    """
    Виртуальная примерка: вырезает фон с одежды через remove.bg,
    накладывает на фото человека с умным позиционированием.
    Работает быстро (~3-5 сек), бесплатно, без внешних AI сервисов.
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

    # ── Примерка ─────────────────────────────────────────────────────────────
    if action == 'run':
        model_b64 = body.get('model_image')
        garment_b64 = body.get('garment_image')
        category = body.get('category', 'tops')

        if not model_b64 or not garment_b64:
            return {'statusCode': 400, 'headers': CORS,
                    'body': json.dumps({'error': 'Нужны model_image и garment_image'})}

        remove_bg_key = os.environ.get('REMOVE_BG_API_KEY', '')
        if not remove_bg_key:
            return {'statusCode': 500, 'headers': CORS,
                    'body': json.dumps({'error': 'REMOVE_BG_API_KEY не настроен'})}

        # 1. Декодируем фото
        person_img = decode_base64_image(model_b64)
        garment_img = decode_base64_image(garment_b64)

        # 2. Убираем фон с одежды
        garment_nobg = remove_background(garment_img, remove_bg_key)

        # 3. Накладываем одежду на человека
        result_img = composite_outfit(person_img, garment_nobg, category)

        # 4. Сохраняем результат в S3
        result_url = save_image_to_s3(result_img)

        return {
            'statusCode': 200,
            'headers': CORS,
            'body': json.dumps({'status': 'completed', 'result_url': result_url}),
        }

    # ── Сохранение копии в историю ───────────────────────────────────────────
    elif action == 'save':
        image_url = body.get('image_url')
        if not image_url:
            return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Нужен image_url'})}

        img_bytes = requests.get(image_url, timeout=30).content
        s3 = s3_client()
        file_key = f'tryon-history/{uuid.uuid4()}.jpg'
        s3.put_object(Bucket='files', Key=file_key, Body=img_bytes, ContentType='image/jpeg')
        cdn_url = f"https://cdn.poehali.dev/projects/{os.environ['AWS_ACCESS_KEY_ID']}/bucket/{file_key}"
        return {'statusCode': 200, 'headers': CORS, 'body': json.dumps({'saved_url': cdn_url})}

    return {'statusCode': 400, 'headers': CORS, 'body': json.dumps({'error': 'Неизвестный action'})}
