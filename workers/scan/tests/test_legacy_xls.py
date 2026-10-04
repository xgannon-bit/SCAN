"""Independently authored OLE/BIFF8 fixture, never a copied manufacturing file."""
import struct
import unittest
from workers.scan.placement_intake import read_table, IntakeError


def record(code, payload=b''): return struct.pack('<HH', code, len(payload)) + payload
def bof(kind=5, version=0x0600): return record(0x0809, struct.pack('<HHHHII', version, kind, 0x0dbb, 1997, 0, 6))


def workbook(cell=None, *, hidden_formula=False, sheet_version=0x0600, offset_delta=0):
    if cell is None: cell=record(0x0203,struct.pack('<HHHd',0,0,0,123.0))
    sheet=bof(0x10,sheet_version)+record(0x0200,struct.pack('<IIHHH',0,1,0,1,0))+cell+record(0x000a)
    prefix=bof()+record(0x0042,struct.pack('<H',1200))+record(0x00e0,bytes(20))
    bounds=lambda offset: record(0x0085,struct.pack('<IBBB',offset,0,0,6)+b'\0Sheet1')
    end=record(0x000a)
    if hidden_formula:
        # A malicious BOUNDSHEET points inside another record, which a flat scan skips.
        offset=len(prefix)+len(bounds(0))+4
        stream=prefix+bounds(offset)+record(0x7777,sheet)+end
    else:
        offset=len(prefix)+len(bounds(0))+len(end)+offset_delta
        stream=prefix+bounds(offset)+end+sheet
    stream=stream.ljust(4096,b'\0')
    header=bytearray(512); header[:8]=bytes.fromhex('D0CF11E0A1B11AE1')
    struct.pack_into('<HHHH',header,24,0x003e,3,0xfffe,9); struct.pack_into('<H',header,32,6)
    struct.pack_into('<IIIIIIIII',header,40,0,1,0,0,4096,0xfffffffe,0,0xfffffffe,0)
    struct.pack_into('<109I',header,76,9,*([0xffffffff]*108))
    directory=bytearray(512)
    for pos,name,kind,start,size,child in [(0,'Root Entry',5,0xfffffffe,0,1),(128,'Workbook',2,1,len(stream),0xffffffff)]:
        encoded=(name+'\0').encode('utf-16le'); directory[pos:pos+len(encoded)]=encoded
        struct.pack_into('<HBBIII',directory,pos+64,len(encoded),kind,1,0xffffffff,0xffffffff,child)
        struct.pack_into('<IQ',directory,pos+116,start,size)
    fat=[0xfffffffe]+list(range(2,9))+[0xfffffffe,0xfffffffd]+[0xffffffff]*118
    return bytes(header)+bytes(directory)+stream+struct.pack('<128I',*fat)


class LegacyTests(unittest.TestCase):
    def test_literal_biff8(self):
        table=read_table(workbook(),'xls'); self.assertEqual(table.rows,[[123.0]]); self.assertEqual(table.sheets,[{'index':0,'name':'Sheet1'}])
    def test_formulas_and_offset_bypass(self):
        formula=record(0x0006,struct.pack('<HHHdH',0,0,0,42.,0)+bytes(4)+struct.pack('<H',3)+b'\x1e\x2a\x00')
        for data in [workbook(formula),workbook(formula,hidden_formula=True),workbook(offset_delta=1),workbook(sheet_version=0x0500)]:
            with self.assertRaises(IntakeError): read_table(data,'xls')
    def test_bounds_and_objects(self):
        for cell in [record(0x0203,struct.pack('<HHHd',10000,0,0,1.)),record(0x0203,struct.pack('<HHHd',0,64,0,1.)),record(0x005d,b'\0'*20)]:
            with self.assertRaises(IntakeError): read_table(workbook(cell),'xls')
        with self.assertRaises(IntakeError): read_table(b'fake,renamed,csv','xls')


if __name__ == '__main__': unittest.main()
