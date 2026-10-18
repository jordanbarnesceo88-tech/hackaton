"""Render every current submission PDF page and check text bounds.

Requires PyMuPDF and Pillow. Images go to the caller's output directory, not
into the deliverable. A human must inspect the contact sheets and key pages.
"""
from pathlib import Path
import argparse
import json
import hashlib
import fitz
from PIL import Image, ImageOps, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent / "docs/submission/current"
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
result = {}
for name in ["documentation", "presentation", "sample-report"]:
    document = fitz.open(root / f"{name}.pdf")
    facts = {"sha256": hashlib.sha256((root / f"{name}.pdf").read_bytes()).hexdigest(), "pages": len(document), "blankPages": [], "outsideBounds": [],
             "textChars": sum(len(page.get_text()) for page in document)}
    for index, page in enumerate(document):
        if len(page.get_text().strip()) < 20:
            facts["blankPages"].append(index + 1)
        for block in page.get_text("dict")["blocks"]:
            if "lines" not in block:
                continue
            x0, y0, x1, y1 = block["bbox"]
            if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                facts["outsideBounds"].append({"page": index + 1, "bbox": block["bbox"]})
        page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(output / f"{name}-{index+1:02}.png")
    count = 4 if name == "presentation" else 6
    width, height = (720, 430) if name == "presentation" else (420, 620)
    columns = 2 if name == "presentation" else 3
    for start in range(0, len(document), count):
        canvas = Image.new("RGB", (columns * width, 2 * height), "#d9d9d9")
        draw = ImageDraw.Draw(canvas)
        for offset, index in enumerate(range(start, min(start + count, len(document)))):
            image = Image.open(output / f"{name}-{index+1:02}.png")
            x, y = (offset % columns) * width, (offset // columns) * height
            canvas.paste(ImageOps.contain(image, (width - 12, height - 27)), (x, y))
            draw.text((x + 8, y + height - 23), f"{name} / {index+1}", fill="black")
        canvas.save(output / f"{name}-contact-{start//count+1}.png")
    result[name] = facts
(root / "pdf-qa.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
coverage_path = root / "content-coverage.json"
if coverage_path.exists():
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    normalize = lambda text: "".join(text.lower().split())
    missing = []
    for requirement in coverage["requirements"]:
        pdf = fitz.open(root / requirement["artifact"])
        texts = [normalize(page.get_text()) for page in pdf]
        matches = []
        for title in requirement.get("sections", []):
            pages = [index + 1 for index, text in enumerate(texts) if normalize(title) in text]
            matches.append({"section": title, "pages": pages})
            if not pages:
                missing.append({"clause": requirement["clause"], "section": title})
        requirement["renderedSections"] = matches
        pdf.close()
    coverage["renderedContentPresence"] = {"scope": "Text heading presence and actual PDF pages only; not a substitute for semantic or visual acceptance", "missing": missing}
    coverage_path.write_text(json.dumps(coverage, ensure_ascii=False, indent=2), encoding="utf-8")
    if missing:
        raise SystemExit(f"Missing mandatory content headings: {missing}")
print(json.dumps(result))
if any(facts["blankPages"] or facts["outsideBounds"] for facts in result.values()):
    raise SystemExit(1)
