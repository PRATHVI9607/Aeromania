HERALD Lab samples: 640x640 px, 10 m, uint16 DN = reflectance x 10000, LZW GeoTIFF, Sentinel-2 L2A.
Band order: B02,B03,B04,B08,B11 (blue,green,red,NIR,SWIR1).
Own data: Copernicus Browser multi-band GeoTIFF with raw bands (UINT16) in that order (5 bands),
or a full 12/13-band stack in S2 order (B01..B12 incl. B8A) - the Lab picks the 5 it needs.
RGB-only (3 bands) is rejected: the onboard model needs NIR and SWIR.

blr_construction.tif: blr t1 tiles rows 29-38 cols 1-10, 3.6 MB
hasdeo_mine.tif: hasdeo t1 tiles rows 18-27 cols 36-45, 3.4 MB
blr_cloudy.tif: blr c2 tiles rows 29-38 cols 1-10, 3.7 MB
