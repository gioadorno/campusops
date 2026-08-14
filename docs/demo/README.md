# CampusOps demo assets

These public portfolio assets are generated from `capture-fixture.html`, a continuously animated deterministic presentation fixture that reproduces the real Phase 3A workspace states and styling. The fixture does not authenticate, contact Cognito, invoke Bedrock, call MCP, or contain live infrastructure values. Its identity, service details, support request, timestamps, and activity are fictional. The underlying Phase 3A workflow was separately validated against the deployed AWS dev/reference environment.

Regenerate the screenshot, animated GIF, and MP4 from the repository root:

```bash
pnpm demo:capture
```

The capture script records the running browser through the Chrome DevTools screencast API, then uses FFmpeg to encode the H.264 MP4, looping GIF, and approval-state screenshot. It does not concatenate staged screenshots. Override the local browser and encoder paths with `CHROME_PATH` and `FFMPEG_PATH` if necessary.
