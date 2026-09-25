`import-video.mp4` is a synthetic 16×16, two-frame H.264 video used to exercise
the real media probe and asset import without a browser or external footage.
It was generated with:

```sh
ffmpeg -f lavfi -i color=c=blue:s=16x16:r=2 -frames:v 2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart import-video.mp4
```
