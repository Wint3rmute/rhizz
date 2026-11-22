# Pinned font set for visual regression tests (web/vrt): the VRT browser
# sees only these fonts, so text renders identically on every machine
# instead of depending on host-installed fonts. Hand-written (not
# makeFontsConf, which also pulls in /usr/share/fonts and /etc/fonts/conf.d)
# and with rendering pinned, so host fontconfig settings (hinting, subpixel
# AA) cannot leak in either.
{ writeText, dejavu_fonts, liberation_ttf, noto-fonts-color-emoji }:

writeText "rhizz-vrt-fonts.conf" ''
  <?xml version="1.0"?>
  <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
  <fontconfig>
    <dir>${dejavu_fonts}/share/fonts</dir>
    <dir>${liberation_ttf}/share/fonts</dir>
    <dir>${noto-fonts-color-emoji}/share/fonts</dir>
    <cachedir>/tmp/rhizz-vrt-fontcache</cachedir>
    <alias binding="strong"><family>sans-serif</family><prefer><family>DejaVu Sans</family></prefer></alias>
    <alias binding="strong"><family>system-ui</family><prefer><family>DejaVu Sans</family></prefer></alias>
    <alias binding="strong"><family>serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
    <alias binding="strong"><family>monospace</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
    <alias binding="strong"><family>emoji</family><prefer><family>Noto Color Emoji</family></prefer></alias>
    <!-- Unknown families (e.g. "Segoe UI") fall back to DejaVu Sans. -->
    <match target="pattern">
      <edit name="family" mode="append_last"><string>DejaVu Sans</string></edit>
    </match>
    <match target="font">
      <edit name="antialias" mode="assign"><bool>true</bool></edit>
      <edit name="hinting" mode="assign"><bool>true</bool></edit>
      <edit name="hintstyle" mode="assign"><const>hintslight</const></edit>
      <edit name="rgba" mode="assign"><const>none</const></edit>
      <edit name="lcdfilter" mode="assign"><const>lcdnone</const></edit>
      <edit name="autohint" mode="assign"><bool>false</bool></edit>
      <edit name="embeddedbitmap" mode="assign"><bool>false</bool></edit>
    </match>
  </fontconfig>
''
