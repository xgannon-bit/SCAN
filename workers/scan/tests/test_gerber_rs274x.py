from __future__ import annotations
from hashlib import sha256
from pathlib import Path
import tempfile, unittest
from workers.scan.gerber_rs274x import GerberLimits, parse_gerber


def g(body: str, units="MM", fs="FSLAX24Y24") -> str:
    return f"%MO{units}*%\n%{fs}*%\n{body}\nM02*\n"


class T(unittest.TestCase):
    def setUp(self): self.t=tempfile.TemporaryDirectory(); self.root=Path(self.t.name)
    def tearDown(self): self.t.cleanup()
    def w(self, text, name="s.gbr"):
        p=self.root/name; p.write_text(text,encoding="ascii"); return p

    def test_units_and_flash(self):
        for u, expected in [("MM","mm"),("IN","in")]:
            r=parse_gerber(self.w(g("%ADD10C,0.25*%\nD10*\nX10000Y20000D03*",u),u+".gbr")); self.assertEqual((r.status,r.units),("success",expected)); self.assertEqual((r.objects[0].end_x,r.objects[0].end_y),("1","2"))
    def test_required_header_and_eof(self):
        for text, needle in [("%FSLAX24Y24*%\nM02*\n","MO"),("%MOMM*%\nM02*\n","FS"),("%MOMM*%\n%FSLAX24Y24*%\n","M02")]:
            r=parse_gerber(self.w(text,needle+".gbr")); self.assertEqual(r.status,"blocked"); self.assertTrue(any(needle in x for x in r.blocked_reasons))
    def test_repeated_header_blocks(self):
        for field in ["MO","FS"]:
            text="%MOMM*%\n%FSLAX24Y24*%\n"+("%MOMM*%\n" if field=="MO" else "%FSLAX24Y24*%\n")+"M02*\n"; self.assertEqual(parse_gerber(self.w(text,field+"2.gbr")).status,"blocked")
    def test_fs_modes_and_decimal(self):
        for fs in ["FSTAX24Y24","FSLIX24Y24"]:
            r=parse_gerber(self.w(g("",fs=fs),fs+".gbr")); self.assertEqual(r.status,"unsupported"); self.assertIn("UNSUPPORTED_FS_MODE",r.unsupported_features)
        self.assertNotEqual(parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\nX1.0Y2D03*"),"decimal.gbr")).status,"success")
    def test_negative_and_modal_coordinates(self):
        r=parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\nX-10000Y10000D02*\nD01*\nX20000*"))); self.assertEqual(r.status,"success"); self.assertEqual((r.objects[0].start_x,r.objects[0].end_x,r.objects[0].end_y),("-1","2","1"))
    def test_apertures(self):
        r=parse_gerber(self.w(g("%ADD10C,0.25*%\n%ADD11R,0.6X0.4*%\n%ADD12O,0.7X0.5*%\n%ADD13P,1X6X30*%"))); self.assertEqual([a.template for a in r.apertures],["C","R","O","P"]); self.assertEqual(r.apertures[-1].parameters,("1","6","30"))
    def test_aperture_errors(self):
        self.assertEqual(parse_gerber(self.w(g("%ADD10C,0.1*%\n%ADD10C,0.2*%"),"dup.gbr")).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("D10*\nX1Y1D03*"),"undef.gbr")).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("X1Y1D03*"),"none.gbr")).status,"blocked")
    def test_moves_draws_and_g01(self):
        r=parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\nX10000Y10000D02*\nG01X20000Y30000D01*"))); self.assertEqual(len(r.objects),1); self.assertEqual((r.objects[0].operation,r.objects[0].start_x,r.objects[0].end_y),("draw","1","3")); self.assertIn("G01",r.supported_features)
        self.assertEqual(parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\nX1Y1D01*"),"noprior.gbr")).status,"blocked")
    def test_polarity_attributes_and_td(self):
        r=parse_gerber(self.w(g("%TF.FileFunction,Paste,Top*%\n%TA.AperFunction,SMDPad*%\n%ADD10C,0.1*%\nD10*\n%LPD*%\nX1Y1D03*\n%LPC*%\nX2Y1D03*"))); self.assertEqual([o.polarity for o in r.objects],["dark","clear"]); self.assertEqual(r.file_attributes[0][0],"FileFunction"); self.assertEqual(r.apertures[0].attributes[0][0],"AperFunction")
        r=parse_gerber(self.w(g("%TA.AperFunction,SMDPad*%\n%TD*%\n%ADD10C,0.1*%"),"td.gbr")); self.assertEqual(r.apertures[0].attributes,())
    def test_sr(self):
        r=parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\n%SRX2Y2I10J20*%\nX10000Y10000D03*\n%SR*%\nX20000Y10000D03*"))); self.assertEqual(len(r.objects),5); self.assertEqual(r.objects[3].sr_instance,(1,1)); self.assertEqual((r.objects[3].end_x,r.objects[3].end_y),("11","21")); self.assertIsNone(r.objects[-1].sr_instance)
        self.assertEqual(parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\n%SRX3Y3I1J1*%\nX1Y1D03*"),"srlim.gbr"),GerberLimits(max_sr_expansion=4)).status,"blocked")
    def test_unsupported_geometry_is_visible(self):
        cases={"%AMMAC*1,1,1,0,0*%":"APERTURE_MACRO","G02*":"ARC_CLOCKWISE","G03*":"ARC_COUNTERCLOCKWISE","G36*":"REGION_BEGIN","G37*":"REGION_END","%AB*%":"APERTURE_BLOCK","%LMX*%":"LOAD_MIRRORING","%LR90*%":"LOAD_ROTATION","%LS2*%":"LOAD_SCALING","G70*":"DEPRECATED_UNIT_INCH"}
        for i,(frag,code) in enumerate(cases.items()):
            with self.subTest(frag=frag):
                r=parse_gerber(self.w(g(frag),f"u{i}.gbr")); self.assertEqual(r.status,"unsupported"); self.assertIn(code,r.unsupported_features)
        r=parse_gerber(self.w(g("G99*"),"unknown.gbr")); self.assertIn("UNKNOWN_COMMAND",r.unsupported_features)
    def test_malformed_and_limits(self):
        self.assertEqual(parse_gerber(self.w("%MOMM*%\n%FSLAX24Y24*%\n%ADD10C,0.1*\nM02*\n","mal.gbr")).status,"blocked")
        self.assertEqual(parse_gerber(self.w("%MOMM*%\n%FSLAX24Y24*%\nM02*\nG04 x*\n","after.gbr")).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("G04 "+"x"*100),"size.gbr"),GerberLimits(max_source_bytes=20)).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("G04 a*\nG04 b*\nG04 c*"),"cmd.gbr"),GerberLimits(max_commands=3)).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("%ADD10C,0.1*%\n%ADD11C,0.2*%"),"aper.gbr"),GerberLimits(max_apertures=1)).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("%ADD10C,0.1*%\nD10*\nX1Y1D03*\nX2Y2D03*"),"obj.gbr"),GerberLimits(max_objects=1)).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("%TF.FileFunction,"+"x"*30+"*%"),"attr.gbr"),GerberLimits(max_attribute_length=12)).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("G04 "+"x"*30+"*"),"comment.gbr"),GerberLimits(max_comment_length=12)).status,"blocked")
        self.assertEqual(parse_gerber(self.w(g("%ADD10C,123456789*%"),"num.gbr"),GerberLimits(max_numeric_token_length=4)).status,"blocked")
    def test_non_ascii(self):
        p=self.root/"bad.gbr"; p.write_bytes(b"%MOMM*%\n%FSLAX24Y24*%\nG04 \xff*\nM02*\n"); self.assertIn("NON_ASCII_SOURCE",parse_gerber(p).unsupported_features)
    def test_integrity_determinism_and_identity(self):
        p=self.w(g("%ADD10C,0.1*%\nD10*\nX10000Y20000D03*\nX20000Y20000D03*")); before=p.read_bytes(); h=sha256(before).hexdigest(); a=parse_gerber(p); b=parse_gerber(p); self.assertEqual(a,b); self.assertEqual(a.source_sha256,h); self.assertEqual(p.read_bytes(),before); self.assertEqual(a.coordinate_frame,"gerber-source-native"); self.assertEqual([o.instance_id for o in a.objects],["obj-000001","obj-000002"]); payload=str(a.to_dict()).lower(); self.assertNotIn("refdes",payload); self.assertNotIn("owner",payload)
    def test_source_mutation_blocks(self):
        p=self.w(g("%ADD10C,0.1*%"),"mut.gbr")
        def mutate(): p.write_text(p.read_text()+"G04 changed*\n",encoding="ascii")
        r=parse_gerber(p,_post_parse_hook=mutate); self.assertEqual(r.status,"blocked"); self.assertIn("source Gerber changed during parsing",r.blocked_reasons)


if __name__ == "__main__": unittest.main()
