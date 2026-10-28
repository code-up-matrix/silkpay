"""Regenerate fictional proof fixtures; requires reportlab and Poppler."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.graphics.barcode import code128
import subprocess
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('SilkSans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('SilkSans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

root = Path(__file__).resolve().parent.parent
out = root / 'public' / 'samples'
out.mkdir(exist_ok=True, parents=True)
navy = HexColor('#003087')
blue = HexColor('#0070BA')
gray = HexColor('#64748B')

def page(name, title, subtitle):
    c = canvas.Canvas(str(out / name), pagesize=(612, 792), invariant=1)
    c.setTitle('FICTIONAL SAMPLE - ' + title)
    c.setAuthor('SilkPay hackathon demonstration')
    c.setFillColor(navy); c.rect(0, 720, 612, 72, fill=1, stroke=0)
    c.setFillColor(HexColor('#FFFFFF')); c.setFont('SilkSans-Bold', 20); c.drawString(42, 750, 'SilkPay')
    c.setFont('SilkSans', 9); c.drawRightString(570, 753, 'FICTIONAL DEMO EVIDENCE')
    c.setFillColor(HexColor('#FFF6D9')); c.rect(42, 665, 528, 34, fill=1, stroke=0)
    c.setFillColor(HexColor('#795D19')); c.setFont('SilkSans-Bold', 10); c.drawString(55, 678, 'SAMPLE ONLY - NOT VALID FOR TRADE OR CERTIFICATION')
    c.setFillColor(navy); c.setFont('SilkSans-Bold', 21); c.drawString(42, 625, title)
    c.setFillColor(gray); c.setFont('SilkSans', 10); c.drawString(42, 605, subtitle)
    c.setFont('SilkSans', 9); c.drawString(42, 48, 'SilkPay | Fictional hackathon fixture | No certificate or carrier endorsement')
    c.drawRightString(570, 48, '1 / 1')
    return c

def rows(c, pairs, y):
    for k, v in pairs:
        c.setStrokeColor(HexColor('#E2E8F0')); c.line(42, y-12, 570, y-12)
        c.setFillColor(gray); c.setFont('SilkSans', 10); c.drawString(42, y, k)
        c.setFillColor(navy); c.setFont('SilkSans-Bold', 10); c.drawString(215, y, v)
        y -= 36
    return y

c=page('SGS_inspection_SAMPLE.pdf','Pre-shipment inspection','PO SK-8821 | Custom Biodegradable Packaging | Sample measurements')
y=rows(c,[('Buyer','Apex Goods LLC (USA)'),('Supplier','Dongguan Precision Print Ltd (China)'),('Quantity / cartons','5,000 units / 100 master cartons'),('Gross shipment weight','600 kg'),('Nominal dimensions','200.0 x 150.0 x 80.0 mm'),('Measured sample','200.3 x 149.8 x 80.1 mm'),('Maximum deviation','0.3 mm (required limit: 0.5 mm)'),('Carton reference','SK8821-C001 through SK8821-C100')],565)
c.setStrokeColor(blue); c.roundRect(42,170,528,76,7,stroke=1,fill=0)
c.setFillColor(blue);c.setFont('SilkSans-Bold',12);c.drawString(57,220,'MOCK SGS QUALITY STAMP - DEMONSTRATION ONLY')
c.setFillColor(gray);c.setFont('SilkSans',10);c.drawString(57,199,'This is not an SGS-issued certificate. No inspection was performed.')
c.drawString(57,184,'All measurements and identifiers above are fictional sample data.')
c.save()
c=page('Bill_of_lading_SAMPLE.pdf','Bill of lading - sample','PO SK-8821 | Shipment manifest for demonstration only')
rows(c,[('Shipper','Dongguan Precision Print Ltd (China)'),('Consignee','Apex Goods LLC (USA)'),('Corridor','Shenzhen, CN to San Francisco, USA'),('Goods','Custom Biodegradable Packaging'),('Quantity','5,000 units'),('Master cartons','100 cartons x 50 units'),('Gross weight','600 kg'),('Carton identifiers','SK8821-C001 through SK8821-C100'),('Carrier / signature','SAMPLE ONLY - no carrier or signature')],565)
c.setFillColor(gray);c.setFont('SilkSans',10);c.drawString(42,190,'This fictional manifest is not proof of shipment, carriage or delivery.');c.save()
# A precise, synthetic label diagram; not a photograph or genuine shipping label.
tmp=Path('/tmp/silkpay-pdfs/label.pdf')
c=canvas.Canvas(str(tmp),pagesize=(480,300),invariant=1)
c.setFillColor(HexColor('#F3F6FA'));c.rect(0,0,480,300,fill=1,stroke=0)
c.setFillColor(HexColor('#FFFFFF'));c.roundRect(20,20,440,260,8,fill=1,stroke=0)
c.setFillColor(navy);c.setFont('SilkSans-Bold',16);c.drawString(42,248,'MASTER CARTON 001 / 100')
c.setFillColor(gray);c.setFont('SilkSans',11);c.drawString(42,223,'PO SK-8821 | 50 units | Gross weight: 6 kg')
c.drawString(42,202,'Apex Goods LLC / Dongguan Precision Print Ltd')
code128.Code128('SK8821-C001',barHeight=58,barWidth=1.65).drawOn(c,42,112)
c.setFillColor(navy);c.setFont('Courier-Bold',15);c.drawString(65,91,'SK8821-C001')
c.setFillColor(HexColor('#9A6A19'));c.setFont('SilkSans-Bold',11);c.drawString(42,55,'SAMPLE DIAGRAM - NOT A SHIPPING LABEL')
c.save()
subprocess.run(['pdftoppm','-scale-to','1200','-png','-singlefile',str(tmp),str(out/'Carton_labels_SAMPLE')],check=True)
