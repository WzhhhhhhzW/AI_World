"""Generate the compact Chromium assets from the original village artwork (Pillow required)."""

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw


ASSETS = Path(__file__).resolve().parents[1] / "web" / "assets"
OUT = ASSETS / "tcg"
NEAREST = Image.Resampling.NEAREST


def read(name):
    return json.loads((ASSETS / name).read_text(encoding="utf-8"))


def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def images(manifest):
    return {key: Image.open(ASSETS / spec["file"]).convert("RGBA") for key, spec in manifest["sheets"].items()}


def crop(image, rect):
    x, y, w, h = rect
    return image.crop((x, y, x + w, y + h))


def pack(name, sprites):
    """Lay out the small, already cropped sprites. One transfer and one decode per atlas."""
    width = 768
    x = y = line = 0
    locations = {}
    for key, image in sprites.items():
        w, h = image.size
        if x + w > width:
            x, y, line = 0, y + line + 1, 0
        locations[key] = [x, y, w, h]
        x += w + 1
        line = max(line, h)
    sheet = Image.new("RGBA", (width, y + line))
    for key, image in sprites.items():
        sheet.paste(image, tuple(locations[key][:2]))
    sheet.save(OUT / name, lossless=True, method=6)
    return {"packed": {"file": "tcg/" + name, "size": list(sheet.size)}}, locations


def scenery():
    data = read("scenery.json")
    sheets = images(data)
    sprites = {}
    for key, spec in data["assets"].items():
        source = crop(sheets[spec["sheet"]], spec["rect"])
        width, height = spec["size"]
        sprite = Image.new("RGBA", (width, height))
        if anchor := spec.get("anchor"):
            ratio = min((width - 2) / source.width, (anchor[1] - 1) / source.height)
            w, h = round(source.width * ratio), round(source.height * ratio)
            sprite.paste(source.resize((w, h), NEAREST), (round((width - w) / 2), anchor[1] - h))
        else:
            sprite = source.resize((width, height), NEAREST)
        sprites[key] = sprite
    data["sheets"], rects = pack("scenery.webp", sprites)
    for key, spec in data["assets"].items():
        spec.update(sheet="packed", rect=rects[key])
    data["prerendered"] = True
    write("scenery.json", data)


def ui():
    data = read("ui-atlas.json")
    sheets = images(data)
    sprites = {}
    for key, spec in data["icons"].items():
        image = crop(sheets[spec["sheet"]], spec["rect"])
        image.thumbnail((80, 80), Image.Resampling.LANCZOS)
        sprites[key] = image
    for key, spec in data["effects"].items():
        for index, rect in enumerate(spec["frames"]):
            image = crop(sheets[spec["sheet"]], rect)
            image.thumbnail((120, 64), Image.Resampling.LANCZOS)
            sprites[f"{key}.{index}"] = image
    data["sheets"], rects = pack("ui-atlas.webp", sprites)
    for key, spec in data["icons"].items():
        spec.update(sheet="packed", rect=rects[key])
    for key, spec in data["effects"].items():
        spec.update(sheet="packed", frames=[rects[f"{key}.{i}"] for i in range(len(spec["frames"]))])
    write("ui-atlas.json", data)


def avatars():
    data = read("avatars.json")
    sheet = Image.open(ASSETS / data["file"]).convert("RGBA")
    sprites = {}
    for key, spec in data["characters"].items():
        sprite = crop(sheet, spec["rect"])
        if spec.get("clip"):
            mask = Image.new("L", sprite.size)
            ImageDraw.Draw(mask).polygon([tuple(point) for point in spec["clip"]], fill=255)
            clipped = Image.new("RGBA", sprite.size)
            clipped.paste(sprite, (0, 0), mask)
            sprite = clipped
        sprite.thumbnail((192, 192), Image.Resampling.LANCZOS)
        sprites[key] = sprite
    files, rects = pack("avatars.webp", sprites)
    data = {**files["packed"], "characters": {key: {"rect": rect} for key, rect in rects.items()}}
    write("avatars.json", data)


def skin():
    data = read("ui-skin-v2.json")
    image = Image.open(ASSETS / data["file"]).convert("RGBA")
    declarations = []
    for key, spec in data["sprites"].items():
        buffer = io.BytesIO()
        crop(image, spec["rect"]).save(buffer, format="WEBP", quality=88, method=6)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        declarations.append(f'  --skin-{key}: url("data:image/webp;base64,{encoded}");')
    (OUT / "skin.css").write_text(":root {\n" + "\n".join(declarations) + "\n}\n", encoding="ascii")
    write("skin.json", {"version": data["version"], "regions": len(declarations)})


def valley_plate():
    """Bake in the three roof patches used by VillageProps.cleanPlate."""
    plate = Image.open(ASSETS / "maps" / "valley-painted-v1.png").convert("RGBA")
    roof = Image.open(ASSETS / "props" / "rooftop-motion.png").convert("RGBA")
    for source, destination in (
        ((0, 32, 35, 28), (630, 180)),
        ((40, 32, 37, 28), (821, 180)),
        ((80, 32, 40, 44), (970, 371)),
    ):
        plate.alpha_composite(crop(roof, source), dest=destination)
    plate.convert("RGB").save(OUT / "valley-painted-v1.webp", quality=90, method=6)


def waterwheel():
    """Pack a small wheel face and hub with room between their sampling edges."""
    original = Image.open(ASSETS / "props" / "waterwheel-front-v1.png").convert("RGBA")
    atlas = Image.new("RGBA", (274, 224))
    face = crop(original, (139, 139, 982, 982)).resize((224, 224), Image.Resampling.LANCZOS)
    hub = crop(original, (529, 529, 196, 196)).resize((48, 48), Image.Resampling.LANCZOS)
    atlas.paste(face, (0, 0))
    atlas.paste(hub, (226, 0))
    atlas.save(OUT / "waterwheel-front-v1.webp", quality=88, method=6)


def main():
    OUT.mkdir(exist_ok=True)
    scenery()
    ui()
    avatars()
    skin()
    valley_plate()
    for name in ("eastwood-v1", "council-hall-v1"):
        Image.open(ASSETS / "maps" / (name + ".png")).convert("RGB").save(OUT / (name + ".webp"), quality=90, method=6)
    waterwheel()


if __name__ == "__main__":
    main()
