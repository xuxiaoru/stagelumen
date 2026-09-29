---
title: "Pan/Tilt Speed and Accuracy in Moving Heads: Why It Matters for Broadcast and Capture"
slug: "pantilt-speed-and-accuracy-in-moving-heads-why-it-matters-for-broadcas-z5qa"
date: "2026-09-22T19:01:29.199Z"
author: "RiGeBa Lighting Team"
category: "How-To"
image: "assets/images/products/rg-ml500rs-knnw1h20.jpg"
imageAlt: "500W LED CMY 3-in-1 BSW moving head light"
excerpt: "A camera sees a fixture differently than a room does. What pan/tilt speed, repeatability and PWM frequency mean on screen."
tags:
  - Moving Head
  - Broadcast
  - Pan Tilt
  - Camera
faq:
  - "Why does pan/tilt speed matter more on camera than live?::A live audience reads a move as energy, so faster looks better. A camera records it frame by frame, so what matters is whether the fixture arrives exactly where the operator aimed it and holds there. Overshoot and settle time are visible on screen and invisible in a room."
  - "What is the difference between accuracy and repeatability?::Accuracy is whether the fixture reaches the position you commanded. Repeatability is whether it reaches the same position every time you call that cue. For broadcast, repeatability matters more: a fixture that always lands slightly off can be focused around, one that lands differently each time cannot."
  - "Why does my moving head flicker on camera but not to the eye?::LED dimming is pulse-width modulation, and a shutter speed faster than that pulse rate catches part of the dark cycle. The eye integrates it; a sensor does not. The fix is a fixture with a high PWM frequency or a console-side dimming curve, and it is worth testing before a shoot."
  - "Does 16-bit pan/tilt make a visible difference?::Yes, on slow moves. Eight-bit resolution gives 256 steps across the range, which produces visible stair-stepping on a slow pan. Sixteen-bit gives 65,536 steps by using two channels per parameter — coarse and fine — which is why it is worth the channel count on camera work."
  - "What noise level is acceptable for a broadcast fixture?::Ask for the figure at one metre. A fixture that is inaudible in a club is clearly audible on a location interview, and a directional microphone hears what the room does not. Low-noise or silent fan modes exist on some units and are worth asking for by name."
---

A room and a camera disagree about what makes a moving head good. Live, speed reads as energy and nobody notices a fixture settling a degree past its mark. On capture, the settling is the shot, and a slow pan that steps is visible in every frame.

## The short answer

For broadcast, buy for repeatability and dimming quality before raw speed. A fixture that returns to the same position every time, dims without banding and runs quietly is worth more than one with the fastest published pan figure. Ask for the specification that matters — settle time, PWM frequency and noise at one metre — because the headline speed figure is measured unloaded at maximum and tells you almost nothing about how a move looks on screen.

## What does the published pan/tilt figure actually measure?

Usually the fastest possible move: full range, no load, maximum speed setting, often without a gobo or a heavy lens in the path. It is a fair number and it is close to useless.

| Specification | What it usually means | What to ask instead |
|---|---|---|
| Pan/tilt speed in degrees per second | Maximum, unloaded | Settle time to a defined position |
| "540° pan, 270° tilt" | Mechanical range | Whether the range is usable at your trim |
| 8-bit / 16-bit | Resolution of the position channel | Whether 16-bit is available on both pan and tilt |
| Repeatability | Rarely published | Ask directly; it is the number that matters |
| Noise | Sometimes given, rarely at a distance | dB(A) at 1 m, and whether there is a silent mode |

Accuracy and repeatability are different complaints. Accuracy is whether the fixture reaches the commanded position; repeatability is whether it reaches the same place every time the cue runs. A repeatable fixture that is consistently a degree off can be focused around once. A fixture that lands somewhere different each night cannot be focused at all.

## Why does a moving head flicker on camera but not to the eye?

Because LED dimming switches the emitter on and off faster than the eye can resolve, and a camera shutter can be faster than that.

| Capture setting | What goes wrong | The fix |
|---|---|---|
| High shutter speed | Banding across the frame | Higher PWM frequency on the fixture |
| Slow-motion capture | Severe banding or rolling artefacts | Test at the frame rate before the shoot |
| Low dimmer levels | Stepping instead of a smooth fade | 16-bit dimming, or a console dimming curve |
| Mixed fixture types | Different PWM rates beating together | Standardise the fixtures in shot |
| Any camera at 50/60 Hz | Mains-frequency hum in the driver | Quality driver design; test it |

The test is cheap and worth running before a booking: point a camera at the fixture at the shutter speed you intend to use, ramp the dimmer from zero, and watch the monitor rather than the room.

## What else does a camera see that a room does not?

Colour rendering, noise, and the shape of the beam at the edges.

| Camera-facing issue | Symptom on screen | What to specify |
|---|---|---|
| Poor CRI or TLCI | Skin tones look grey or green | High-CRI white engines, tunable white where possible |
| Colour shift on dimming | Hue changes as the level drops | RGBW or RGBWW engines over RGB |
| Hard beam edges | Visible hot spots on a face | Wash fixtures with even field, or diffusion |
| Fan noise | Audible on a location microphone | dB(A) at 1 m, silent mode if offered |
| Position drift between takes | Focus changes between shots | Repeatability, and a re-park before each take |

## Which fixtures are worth considering for camera work?

The ones with good white light and 16-bit control. In our range that means the CMY hybrids for movement, and the profile and theatre units for front light.

| Model | Type | Why it suits capture | EXW, 1 unit |
|---|---|---|---|
| RG-ML400RS-KNNW1H21 | 400W CMY 3-in-1 BSW | CMY mixing holds a consistent colour on camera | US$459 |
| RG-ML500RS-KNNW1H20 | 500W CMY 3-in-1 BSW | Higher output for larger spaces | US$569 |
| RG-ML300BR-KN1H17 | 300W 3-in-1 BSW | Cheapest unit with a gobo wheel and zoom | US$315 |
| RG-PS200A20T50-W | 200W LED Fresnel zoom | Tunable white front light with a soft edge | US$95 |
| RG-PS150A110-Wg | 200W RGBWW 5-in-1 panel | Five-colour mixing for skin tones | US$105 |
| RG-PS200A110-W | 200W tricolor soft light | Smooth field for interview setups | US$115 |
| RG-TH4B450 | 4 × 100W cool and warm white | COB white with warm/cool balance | US$95 |

The profile and panel units are the ones that do the actual front light. [The 200W Fresnel zoom](/products/profile/rg-ps200a20t50-w) is tunable white with a soft, even field, which is what a camera wants on a face, and it costs a fraction of a moving head because it does not move.

For movement in shot, [the 400W CMY hybrid](/products/moving/rg-ml400rs-knnw1h21) is the practical choice. CMY mixing holds a consistent colour as the level changes, which RGB mixing does not always do, and that is the difference between a look that survives a cut and one that shifts between takes.

## How should channel budget be spent on camera work?

On resolution, not on quantity. Sixteen-bit pan, tilt and dimming costs channels and is worth every one of them.

| Parameter | 8-bit | 16-bit | Worth it for |
|---|---|---|---|
| Pan | 1 channel | 2 channels | Any slow move on camera |
| Tilt | 1 channel | 2 channels | Any slow move on camera |
| Dimmer | 1 channel | 2 channels | Slow fades, low-level work |
| Colour | 1 channel | 2 channels | Long cross-fades |

Sixteen-bit uses two channels per parameter — a coarse channel and a fine one — so a fixture that needs eight channels in 8-bit mode wants fourteen in 16-bit. On a console with a fixed universe count, spend the extra channels on the fixtures that move slowly in shot and leave the fast effects in 8-bit.

## What should you ask a supplier before a broadcast order?

Four questions, and the answers should be measurable.

| Question | A good answer | A weak answer |
|---|---|---|
| What is the settle time to a defined position? | A number, in milliseconds | "It is fast" |
| Is 16-bit available on pan, tilt and dimmer? | Yes, on all three | "16-bit capable" |
| What is the PWM frequency? | A figure in kHz | Unspecified |
| What is the noise level at 1 m? | dB(A) at 1 m, plus a silent mode | "It is quiet" |

If a supplier cannot answer the first and third, assume the fixture has not been specified for camera work and test it yourself before committing.

## What to send us

Tell us the camera format, the shutter speed you shoot at, the throw distance and whether the room needs to be quiet. We will recommend a mix of white front light and moving fixtures that will hold up on capture, and send the specifications you need to check first.
