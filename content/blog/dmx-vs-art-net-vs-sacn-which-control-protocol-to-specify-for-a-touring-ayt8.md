---
title: "DMX vs Art-Net vs sACN: which control protocol to specify for a touring rig"
slug: "dmx-vs-art-net-vs-sacn-which-control-protocol-to-specify-for-a-touring-ayt8"
date: "2026-09-26T18:40:22.871Z"
author: "RiGeBa Lighting Team"
category: "How-To"
image: "assets/images/products/5kg-dmx-control-winch-lifting-machine.jpg"
imageAlt: "DMX-controlled winch lifting machine for kinetic lighting rigs"
excerpt: "DMX512, Art-Net and sACN are not three competing products. Which layer each one owns, and what a touring rig should actually specify."
tags:
  - DMX512
  - Art-Net
  - sACN
  - Control
  - Touring
faq:
  - "Is Art-Net a replacement for DMX512?::No. DMX512 is the electrical and data standard that reaches the fixture; Art-Net carries DMX512 data across an Ethernet network between the console and a converter node. A touring rig uses both: network for the long runs, DMX512 for the last few metres to each fixture."
  - "What is the practical difference between Art-Net and sACN?::Art-Net is a broadcast UDP protocol that is simple to deploy and widely supported. sACN (E1.31) is a standardised streaming protocol with multicast addressing and a per-universe priority field, which makes it better behaved on large networks and when two consoles share a rig."
  - "How many universes does a touring rig need?::Divide the total channel count by 512. A 200-fixture rig at an average 16-channel footprint needs 3,200 channels, which is seven universes. Leave headroom: most plans add one universe for spares and last-minute additions."
  - "Do I need a managed network switch?::For more than two or three universes, yes. Unmanaged switches flood broadcast traffic to every port, and Art-Net is broadcast-heavy. A managed switch with IGMP snooping keeps universes off the ports that do not need them."
  - "Can our fixtures run Art-Net directly?::Our fixtures take DMX512 input. Network protocols run between the console and a converter node, and the node converts to DMX512 for the last run. That split is deliberate and it is how most touring rigs are built."
---

DMX512, Art-Net and sACN get compared as if one of them has to win. They do not: they sit on different layers of the same rig, and a touring specification that picks one is usually a specification that has not been thought through.

## The short answer

Specify DMX512 to the fixture and a network protocol for the long runs. DMX512 is the last-hop standard every fixture understands; Art-Net or sACN carries many universes over cheap Ethernet between the console and the converter nodes. Choose Art-Net for simplicity and compatibility, and sACN when the rig is large enough that multicast behaviour and per-universe priority start to matter. Count universes from the channel total, not from the fixture count.

## What does each protocol actually own?

Each one solves a different distance problem.

| Layer | Protocol | Carries | Typical run |
|---|---|---|---|
| Last hop, console to fixture | DMX512 | 512 channels per line | Up to a few hundred metres of cable |
| Backbone, console to nodes | Art-Net | Many universes over UDP/IP | Ethernet, hundreds of metres per link |
| Backbone, console to nodes | sACN (E1.31) | Many universes, multicast | Ethernet, with priority per universe |
| Configuration and monitoring | RDM | Bidirectional data over the DMX line | Alongside DMX512 |

The boundary that matters is the node. Everything upstream of it is IT infrastructure — switches, cable, IP addresses — and everything downstream is a DMX line with the same rules it has always had: daisy chain, no stars, a terminator at the end.

## When is plain DMX512 still the right answer?

Whenever the rig fits in a couple of universes and the cable runs are short. Adding a network introduces switches, addressing and a second skillset, and none of that pays off below a certain size.

| Rig size | Universes | Right approach |
|---|---|---|
| Up to 512 channels | 1 | Direct DMX512 from the console |
| 1,024–2,048 channels | 2–4 | DMX512 with an isolated splitter per direction |
| 2,048–5,120 channels | 4–10 | Art-Net backbone to nodes |
| Over 5,120 channels | 10+ | sACN with a managed switch |

Under about four universes, the honest answer is a good splitter rather than a network. An [8-output isolated splitter](/products/controller/rg-ca8802-2) gives eight independent DMX lines from one source, which covers most club and corporate rigs with no IP address anywhere on site.

## When does Art-Net earn its place?

When the distance or the universe count makes copper DMX impractical. A festival stage with a console at front of house and fixtures on three trusses 80 m away is the classic case: one network cable to a node at each truss replaces three long DMX runs, and each node feeds its own short chain.

| Model | What it does | EXW, 1 unit |
|---|---|---|
| RG-CR011R | Art-Net / DMX512 converter, 1 channel | US$60 |
| RG-CR0CR021R | Art-Net / DMX512 converter, 2 channels | US$98 |
| RG-CR051R | Art-Net / DMX512 converter, bidirectional | US$166 |
| RG-CRCR041R | Art-Net / DMX512 converter, 4 channels | US$166 |
| RG-CR061S | Art-Net / DMX512 converter, 8 channels | US$245 |

"Channels" here means universes, not DMX channels. [The single-universe converter](/products/controller/rg-cr011r) at US$60 is the cheapest way to put one universe anywhere on a network, and [the eight-universe unit](/products/controller/rg-cr061s) at US$245 is what a large touring rig puts at each truss position.

## Is sACN worth specifying over Art-Net?

On a large rig, yes — for two specific reasons rather than as a general upgrade.

| Behaviour | Art-Net | sACN (E1.31) |
|---|---|---|
| Delivery | Broadcast UDP, often to the whole subnet | Multicast, subscribed per universe |
| Priority | Not part of the base behaviour | Per-universe priority field |
| Two consoles on one rig | Needs planning | Priority handles it |
| Switch requirement | Unmanaged works when small | Managed with IGMP snooping |
| Support | Near-universal | Standard on modern consoles |

The priority field is the practical difference. On a rig with a house console and a visiting console, sACN decides which one owns a universe by priority rather than by whoever last touched a merge setting. Multicast matters for the same reason at scale: broadcast traffic reaches every port on the network whether it is wanted or not.

Below about six universes, neither difference is worth the setup time. Art-Net is simpler to configure, every console supports it, and it is what our converters speak.

## How many universes does a touring rig need?

Work from channels, not fixtures. Multiply the fixture count by its footprint in the mode you will actually use, divide by 512, and round up.

| Rig | Fixtures | Mode | Channels | Universes |
|---|---|---|---|---|
| Club rig | 12 | 16 ch | 192 | 1 |
| Corporate | 40 | 12 ch | 480 | 1 |
| Theatre | 90 | 20 ch | 1,800 | 4 |
| Touring, mid | 200 | 16 ch | 3,200 | 7 |
| Festival | 400 | 20 ch | 8,000 | 16 |

Add one universe of headroom to whatever you calculate. The addition of four fixtures on show day is routine, and a plan with no spare universe turns that into a re-patch.

The fixture count that surprises people is the mid-size touring row: 200 moving heads is seven universes, not two. That is the point at which a network backbone stops being a luxury. Our [200-fixture channel planning guide](dmx-channel-planning-for-a-200-fixture-stage-k8b2.html) works through that rig in detail.

## What should the network look like physically?

Boring and documented. The failure modes on show day are almost never the protocol — they are a switch that rebooted, a port that was never patched, or two devices with the same IP address.

| Element | Specification |
|---|---|
| Addressing | Static IP on every node, written on a label on the device |
| Switch | Managed with IGMP snooping above three universes |
| Cable | Cat6 or better, shielded for long runs near power |
| Redundancy | A second switch and a spare node, patched and tested |
| Segmentation | Lighting on its own subnet or VLAN, separate from audio and video |
| Documentation | A printed network map that matches the labels |

Keep lighting traffic off the audio network. Sharing a switch with audio and video is the most common cause of the intermittent stutter that gets blamed on the protocol.

## What about RDM?

RDM is not a competing protocol — it rides on the DMX line and makes it bidirectional, so the desk can read and set a fixture's start address, mode and status without a ladder.

| Model | What it does | EXW, 1 unit |
|---|---|---|
| RG-CA8402A | Waterproof DMX512 / RDM amplifier | US$98 |
| RG-RDM8802 | Two-way signal distributor | US$84 |
| RG-CA8402C | IP65 4-way isolated splitter | US$72 |
| RG-CA8402MINI | Compact 1-in / 4-out isolated splitter | US$51 |

RDM is worth specifying on any rig where reaching a fixture costs more than the hardware — which is every touring rig. It turns a twenty-minute ladder visit into a menu operation, and it only needs one RDM-capable distributor in the chain.

## Which should you specify?

DMX512 to every fixture, Art-Net as the backbone unless the rig is large enough for sACN's priority handling to matter, and RDM on any position that is expensive to reach. Size the backbone from the channel count plus one universe of headroom, run static addresses, and keep the lighting network separate from everything else.

Send us the fixture count, the mode you run them in and the distance from front of house to the furthest truss, and we will spec the console, the nodes and the splitters at factory pricing.
