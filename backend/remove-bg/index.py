"""
Удаляет фон с изображения одежды через умный алгоритм (GrabCut-подобный через Pillow+numpy).
Принимает base64-изображение, возвращает PNG с прозрачным фоном.
"""
import json
import base64
import io
import numpy as np
from PIL import Image, ImageFilter


def remove_background(img: Image.Image) -> Image.Image:
    """
    Удаляет фон: определяет доминирующий цвет краёв и делает его прозрачным.
    Работает хорошо для фото одежды на однотонном/белом фоне.
    """
    img = img.convert('RGBA')
    data = np.array(img, dtype=np.float32)

    h, w = data.shape[:2]

    # Собираем цвета с краёв (10px рамка) — это фон
    border_pixels = np.concatenate([
        data[:10, :, :3].reshape(-1, 3),
        data[-10:, :, :3].reshape(-1, 3),
        data[:, :10, :3].reshape(-1, 3),
        data[:, -10:, :3].reshape(-1, 3),
    ])

    # Средний цвет фона
    bg_color = border_pixels.mean(axis=0)

    # Вычисляем расстояние каждого пикселя от цвета фона
    pixel_rgb = data[:, :, :3]
    dist = np.sqrt(np.sum((pixel_rgb - bg_color) ** 2, axis=2))

    # Порог: пиксели близкие к фону — прозрачные
    threshold = 60
    alpha = np.where(dist < threshold, 0, 255).astype(np.uint8)

    # Размываем маску для мягких краёв
    alpha_img = Image.fromarray(alpha, 'L')
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=1))

    result = img.copy()
    result.putalpha(alpha_img)
    return result


def handler(event: dict, context) -> dict:
    """Удаляет фон с фотографии одежды. Принимает base64 image, отдаёт PNG без фона."""
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

    body = json.loads(event.get('body') or '{}')
    image_b64 = body.get('image')

    if not image_b64:
        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'No image provided'})}

    # Декодируем base64
    if ',' in image_b64:
        image_b64 = image_b64.split(',')[1]
    image_bytes = base64.b64decode(image_b64)

    # Удаляем фон
    input_img = Image.open(io.BytesIO(image_bytes))
    output_img = remove_background(input_img)

    # Сохраняем как PNG с прозрачностью
    buf = io.BytesIO()
    output_img.save(buf, format='PNG')
    result_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({
            'image': f'data:image/png;base64,{result_b64}',
            'ok': True,
        })
    }
