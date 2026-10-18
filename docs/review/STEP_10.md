# Step 10: camera views and walking

The camera now eases between views and zooms toward the cursor. Open the camera button for Isometric, Top, Eye level, Frame selection, Frame room, or Walk through room. P enters/leaves walk mode; WASD moves and Escape leaves. The existing 2D button now opens the actual top view.

| Before | Updated isometric |
|---|---|
| ![Previous camera](step-9-after-golden-hour.png) | ![Room-centred isometric view](step-10-iso.png) |

| Top | Eye level |
|---|---|
| ![Top view](step-10-top.png) | ![Eye-level view](step-10-eye.png) |

![Walking inside the room](step-10-walk.png)

The living room keeps the exact Codex starting pose. Other rooms centre their own framing. Framing preserves the viewing direction, and furniture drags stop camera movement first. A GPU browser test covers smooth walk entry, movement without edits, framing, and a real furniture drag that leaves the camera still. No page errors occurred during the GPU visual review.
