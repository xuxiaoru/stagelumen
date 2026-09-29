---
title: "DMX Channel Planning for a 200-Fixture Stage"
slug: "dmx-channel-planning-for-a-200-fixture-stage-k8b2"
date: "2026-09-12T12:11:24.517Z"
updated: "2026-09-29"
author: "RiGeBa Lighting Team"
category: "How-To"
image: "assets/images/products/rg-cts4.jpg"
imageAlt: "DMX512 signal splitter with four outputs"
excerpt: "A 200-fixture stage of 24-channel heads is ten universes, not one. How to budget channels, split universes and keep the patch readable."
tags:
  - DMX Channel Planning
  - Stage Lighting
  - LED Moving Heads
  - DMX Universes
faq:
  - "How many universes does a 200-fixture stage need?::It depends entirely on the channel footprint. Two hundred fixtures averaging 16 channels is 3,200 channels, or seven universes; the same count at 32 channels is 6,400 channels, or thirteen. Plan the footprint first and the universe count falls out of it."
  - "Should universes be split by truss or by fixture type?::By physical position, almost always. A universe maps to a cable run, so splitting by truss wing means one failed run takes down one wing rather than every front light on the stage. Fixture type is a labelling convention, not a wiring one."
  - "Do I need a network processing unit?::Only above roughly four universes, or when the consoles are not physically next to the rig. A network processing unit takes one Ethernet feed from the console and distributes many DMX outputs at the truss, which removes long analogue runs."
  - "How many fixtures can share one DMX daisy chain?::Thirty-two is the electrical limit, but eight to twelve is the practical one. Every fixture in a chain adds a connector and a failure point, and one unpowered fixture in the middle breaks everything downstream."
  - "Why does the second universe not respond?::Nine times in ten the console is transmitting it on a different connector or a network port that no node is listening to. Check the output patch before re-addressing fixtures."
---

A 200-fixture stage is not a bigger version of a 24-fixture bar rig. It is a different planning problem, because the binding constraint stops being the fixture list and becomes the channel budget, the number of cable runs, and how many universes a single operator can keep in their head at once.

## The short answer

Budget channels per universe, never per fixture list. At 512 channels a universe, 200 fixtures with a 16-channel footprint need seven universes and 200 fixtures with a 32-channel footprint need thirteen — so decide the footprint before you buy anything. Split universes by physical truss wing, keep each daisy chain under twelve fixtures, and put a network processing unit on the rig once you pass four universes.

## How do I work out the universe count?

Multiply fixtures by footprint, then divide by 512 and round up. Do not stop at the exact number — a stage that fills a universe to 510 channels has no room for the fixture that gets added on the load-in day.

| Fixture | Footprint | Qty | Channels | Universes |
|---|---|---|---|---|
| Moving head, 16-bit pan/tilt | 24 | 48 | 1,152 | 3 |
| Moving head wash | 16 | 60 | 960 | 2 |
| LED PAR, dimmer and strobe | 8 | 72 | 576 | 2 |
| Pixel bar | 40 | 12 | 480 | 1 |
| Blinder | 4 | 8 | 32 | 1 |
| **Total** | — | **200** | **3,200** | **9** |

Nine universes, not two, and that is with a modest 16 to 24 channel footprint. If those same 200 fixtures were full hybrid heads at 32 channels, the total would be 6,400 channels — thirteen universes. The fixture count tells you nothing useful on its own.

## Should universes be split by truss or by fixture type?

Split by physical position. A universe ends up as one or more cable runs to one part of the stage, so if a run fails you lose one wing rather than the entire front truss.

A workable convention for a 200-fixture stage:

- **Universe 1–3:** stage-left truss, movers first, then washes.
- **Universe 4–6:** stage-right truss, same order.
- **Universe 7–8:** upstage bars and pixel fixtures.
- **Universe 9:** blinders, house lights and any spare addresses.

Numbering fixtures left to right within each universe, then writing the number on tape at the fixture, is what makes a 200-fixture rig serviceable at 2 a.m.

## What hardware distributes nine universes?

Once you are past four universes, the console stops being the bottleneck and the distribution does. Real EXW prices from our current range:

| Model | Function | Capacity | EXW, 1 unit |
|---|---|---|---|
| RG-CA8402MINI | DMX mini splitter | 4 outputs | US$51 |
| RG-CR0CR021R | Art-Net / DMX512 network converter | 2 channels | US$98 |
| RG-CS0302 | DMX512 mixer | — | US$148 |
| RG-CTD1024S16F-K | DMX controller | 1024 channels, 16 faders | US$298 |
| QUARTZ (Mini Tiger Touch) | Lighting console | touchscreen, playback faders | US$858 |
| NPU | Network processing unit | many DMX outputs, Ethernet in | US$1,450 |

The cost decision here is straightforward: one NPU at US$1,450 replaces a long bundle of analogue DMX running from the control position to three truss positions. On a 200-fixture stage that bundle is the single most likely thing to be damaged on load-in.

## How many fixtures can share one daisy chain?

Thirty-two is the electrical limit for a DMX chain; eight to twelve is the practical limit. Each fixture adds a connector, a printed circuit board in the signal path, and one more thing to check when a channel misbehaves. A chain of eight fixtures is diagnosable by unplugging one connector. A chain of thirty-two is not.

That is also why splitter outputs are worth the US$51: an 8-output rig splits 200 fixtures into chains of eight or less, which is well inside both limits.

## What should be documented before load-in?

Four documents, and they are all one page each:

1. **Channel budget** — fixtures, footprints, universe totals.
2. **Patch sheet** — every fixture number, universe and address, in physical order.
3. **Run list** — which splitter output feeds which truss position, and cable length.
4. **Spare list** — which addresses and which splitter outputs are empty on purpose.

The last one matters more than it sounds. Knowing that universe 9 is intentionally half empty means the next person adds fixtures there instead of re-planning the show.

## What changes with pixel fixtures?

Pixel bars and pixel-mapped fixtures break the neat arithmetic. A [10×40W pixel bar](/products/moving/rg-ml400br-kcre10ah49) in individual-pixel mode consumes far more channel addresses than the same fixture in a whole-bar mode, and the footprint changes with the mode. Multiply by the worst-case footprint when you plan, not the tidy one: a mode change on the night should never require a new universe.

For washes and beams the footprints are stable, which is why our [moving head range](/products/moving/rg-ml300br-kn1h17) is easy to plan around — one figure per model, fixed unless the operator changes mode.

## How many spare addresses should each universe hold?

Reserve between ten and fifteen percent of every universe and record it as reserved, not as free. A universe loaded to 500 of its 512 channels has no room for a fixture that arrives late or a mode change that adds channels, and the fix at that point is a new universe, a new splitter output and a new run.

On the nine-universe example earlier, that is roughly 50 spare addresses per universe, or about 450 across the rig. It sounds wasteful until the first time a fixture is swapped for one with a larger footprint, which happens on almost every touring rig within a year.

Note the reserved addresses on the patch sheet rather than leaving them blank. A gap that is documented is capacity; a gap that is not is a mystery the next operator will fill with something that breaks the plan.

## What to send us

Send the fixture list with each model's channel footprint, the truss layout, and the distance from the control position to each truss position. We will return the universe count, the splitter and NPU quantities, and a patch sheet laid out in physical order — the version that survives a load-in. If the rig is still being specified, start from the [1024-channel controller](/products/controller/rg-ctd1024s16f-k), which covers two universes from one desk and is the point where a fader-based setup stops being enough.
