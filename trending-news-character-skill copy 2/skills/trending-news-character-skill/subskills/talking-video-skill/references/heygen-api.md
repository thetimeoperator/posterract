# HeyGen API Reference

Use this file inside `talking-video-skill`.

## Default Provider Mode

Use HeyGen by default.

That means:

- text-to-speech happens in HeyGen
- talking-photo rendering happens in HeyGen
- do not create a separate ElevenLabs audio step unless the user deliberately enables the optional ElevenLabs mode in config and supplies the required IDs

## Batch-Level Rule

The product wants one consistent face across the batch.

That means:

- one reference image by default
- one derived `talking_photo_id` reused across the batch when possible
- one voice id reused across the batch unless explicitly overridden
- if you already have a HeyGen avatar look id, reuse that directly as the `talking_photo_id`

## Daily Avatar Rotation Rule

This system uses 3 avatar look ids each day.

- run slot 1 uses the first configured avatar look id
- run slot 2 uses the second configured avatar look id
- run slot 3 uses the third configured avatar look id

The render step should select the avatar look from `config/video.json` using the run slot.

## Preflight Requirements

Require:

- `HEYGEN_API_KEY`
- a valid voice id
- a reference image or existing `talking_photo_id`
- enough quota for the daily batch

Useful endpoints:

- remaining quota: `GET https://api.heygen.com/v2/user/remaining_quota`
- list voices: `GET https://api.heygen.com/v2/voices`
- list avatar groups: `GET https://api.heygen.com/v2/avatar_group.list`

## Image To Talking Photo Flow

If no `talking_photo_id` exists yet:

1. upload the image:
   `POST https://upload.heygen.com/v1/asset`
2. create the photo avatar group:
   `POST https://api.heygen.com/v2/photo_avatar/avatar_group/create`
3. train the group:
   `POST https://api.heygen.com/v2/photo_avatar/train`
4. list group avatars:
   `GET https://api.heygen.com/v2/avatar_group/{group_id}/avatars`
5. use the returned avatar id as `talking_photo_id`

## Render Endpoint

- create video: `POST https://api.heygen.com/v2/video/generate`
- poll status: `GET https://api.heygen.com/v1/video_status.get?video_id=<video_id>`

## Request Shape

```json
{
  "video_inputs": [
    {
      "character": {
        "type": "talking_photo",
        "talking_photo_id": "YOUR_TALKING_PHOTO_ID"
      },
      "voice": {
        "type": "text",
        "input_text": "YOUR_FINAL_SCRIPT",
        "voice_id": "YOUR_VOICE_ID",
        "speed": 1.0
      },
      "background": {
        "type": "color",
        "value": "#101010"
      }
    }
  ],
  "dimension": {
    "width": 1080,
    "height": 1920
  }
}
```

## Status Handling

Treat the provider as asynchronous.

- `pending`: keep polling
- `processing`: keep polling
- `completed`: capture `video_url`
- `failed`: return the error state honestly

## Asset Handling

Persist the returned video URL quickly. HeyGen file URLs expire.

Never tell the user a video exists unless the render actually completed.
