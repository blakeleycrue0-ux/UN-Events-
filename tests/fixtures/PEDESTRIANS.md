# Ensayo opcional de personas pequeñas

No se incluye una fotografía externa en el sitio ni se descarga desde la app.
La prueba manual usó la imagen pública `bus.jpg` del repositorio de YOLOv5:

- Fuente: https://raw.githubusercontent.com/ultralytics/yolov5/master/data/images/bus.jpg
- SHA-256 de los bytes probados: `33b198a1d2839bb9ac4c65d61f9e852196793cae9a0781360859425f6022b69c`
- Autor/proyecto de distribución: Ultralytics / YOLOv5; revisar sus condiciones antes de redistribuir el recurso. La prueba no incorpora modelos YOLO ni publica la fotografía.

Con el archivo descargado localmente y el servidor de la app en marcha:

```sh
python3 tests/person_detail_photo.py /tmp/security-bus-test.jpg
```

El ensayo coloca la fotografía a 300 × 400 píxeles sobre una escena de
1920 × 1080, ejecuta CenterNet local sobre la vista general y después sobre un
recorte de la fuente original. En Chromium se obtuvieron 0 personas por encima
del 45% en la vista general (máximo 31%), y 2 en el recorte (máximo 70%).
Esto prueba una mejora para esa escena, sin demostrar distancia física, precisión
general o funcionamiento de noche. `npm test` no depende de descargar esta imagen.
