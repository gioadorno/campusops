# CampusOps demo assets

These public portfolio assets are generated from `capture-fixture.html`, a deterministic presentation fixture that reproduces the real Phase 3A workspace states and styling. The fixture does not authenticate, contact Cognito, invoke Bedrock, call MCP, or contain live infrastructure values. Its identity, service details, support request, timestamps, and activity are fictional.

Regenerate the screenshot, animated GIF, and MP4 from the repository root:

```bash
pnpm demo:capture
```

The capture script uses a locally installed Chrome/Chromium browser and FFmpeg. Override their paths with `CHROME_PATH` and `FFMPEG_PATH` if necessary.
