# Daily Content Engine

Default flow:

1. choose the active research mode from `config/research.json`
2. discover or accept a topic
3. verify the topic
4. write the script
5. generate the Hyperframes top-half visual in 1:1
6. render the HeyGen talking-head for the bottom half
7. assemble the final vertical master with FFmpeg
8. return the final master

If the user supplied the topic directly, skip X and start from verification.
