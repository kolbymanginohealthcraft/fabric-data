"""Render the methodology markdown to a styled Word .docx (bundled pandoc via pypandoc).

Markdown stays the single source of truth; rerun this after editing the .md to regenerate
the Word file. Three post-pandoc touches, all applied to the 'Table' style so every table
inherits them:
  - full cell-border grid (pandoc's default draws none);
  - shaded header row (fill color) with bold white text;
  - NO field-based TOC, so Word never prompts to "update fields / linked references" on open
    (a TOC field is the only thing that would; headings still navigate via the Navigation Pane).

Header colors are HEADER_FILL / HEADER_TEXT below — change them to restyle every table at once.
Run from repo root:  python -m evaluation.build_docx
"""
from __future__ import annotations
import re
import shutil
import zipfile
from pathlib import Path
import pypandoc

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "docs" / "my-quality-scorecard-methodology.md"
OUT = REPO / "docs" / "my-quality-scorecard-methodology.docx"

# ---- look (all hex RGB, no '#') — change these to restyle every table at once ----
HEADER_FILL = "4472C4"   # header row background (Office Accent-1 blue)
HEADER_TEXT = "FFFFFF"   # header text (white, bold)
BAND_FILL = "D9E2F3"     # alternating body-row shading (light blue)
GRID_COLOR = "BFBFBF"    # cell gridline color (light grey)

# full single-line grid, 0.5pt (sz=4), light-grey gridlines
TBL_BORDERS = (
    "<w:tblBorders>"
    + "".join(f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="{GRID_COLOR}"/>'
              for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
    + "</w:tblBorders>"
)
# bold white header text (conditional rPr for the firstRow)
HEADER_RPR = f'<w:rPr><w:b/><w:color w:val="{HEADER_TEXT}"/></w:rPr>'
HEADER_SHD = f'<w:shd w:val="clear" w:color="auto" w:fill="{HEADER_FILL}"/>'
# banded body rows: shade every other row (band1Horz conditional format)
BAND_STYLEPR = (
    '<w:tblStylePr w:type="band1Horz"><w:tcPr>'
    f'<w:shd w:val="clear" w:color="auto" w:fill="{BAND_FILL}"/>'
    "</w:tcPr></w:tblStylePr>"
)


def style_tables(styles_xml: str) -> str:
    """Restyle the pandoc 'Table' style so every table inherits the same polished look:
    grey grid borders, a shaded bold header row, and banded body rows."""
    m = re.search(r'<w:style\b[^>]*w:styleId="Table"[^>]*>.*?</w:style>', styles_xml, re.S)
    if not m:
        return styles_xml
    block = new = m.group(0)
    # 1. grid borders — OOXML order: tblBorders after tblInd, before tblCellMar
    if "tblBorders" not in new:
        new = new.replace("<w:tblCellMar>", TBL_BORDERS + "<w:tblCellMar>", 1)
    # 2. header row: bold white text (rPr after the firstRow tag) + fill (shd before its vAlign)
    if "<w:shd" not in new:
        new = new.replace('<w:tblStylePr w:type="firstRow">',
                          '<w:tblStylePr w:type="firstRow">' + HEADER_RPR, 1)
        new = re.sub(r'(<w:vAlign\b[^>]*/>)', HEADER_SHD + r"\1", new, count=1)
    # 3. banded body rows — add a band1Horz conditional format before the style closes
    if 'w:type="band1Horz"' not in new:
        new = new.replace("</w:style>", BAND_STYLEPR + "</w:style>", 1)
    return styles_xml.replace(block, new, 1)


def main(src: Path = SRC, out: Path = OUT) -> None:
    src, out = Path(src).resolve(), Path(out).resolve()
    # no --toc: a TOC field is the sole thing that makes Word prompt to update fields on open
    pypandoc.convert_file(str(src), "docx", outputfile=str(out), extra_args=["--standalone"])
    tmp = out.with_suffix(".tmp.docx")
    with zipfile.ZipFile(out) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/styles.xml":
                data = style_tables(data.decode("utf-8")).encode("utf-8")
            zout.writestr(item, data)
    shutil.move(str(tmp), str(out))
    with zipfile.ZipFile(out) as z:
        styles = z.read("word/styles.xml").decode("utf-8")
        doc = z.read("word/document.xml").decode("utf-8", "ignore")
    ntbl = doc.count("<w:tbl>")
    nfields = doc.count('fldCharType="begin"')   # 0 => Word won't prompt to update fields
    print(f"wrote {out.relative_to(REPO)}  | {ntbl} tables"
          f"  borders={'tblBorders' in styles}  header_fill={HEADER_FILL in styles}"
          f"  banded={'band1Horz' in styles}  fields={nfields}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:                          # python -m evaluation.build_docx <src.md> [out.docx]
        s = Path(sys.argv[1])
        o = Path(sys.argv[2]) if len(sys.argv) > 2 else s.with_suffix(".docx")
        main(s, o)
    else:
        main()
