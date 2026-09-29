---
title: "Power, Cabling and Daisy-Chaining Moving Heads: Avoiding the Field-Day Disasters"
slug: "power-cabling-and-daisy-chaining-moving-heads-avoiding-the-field-day-d-u8as"
date: "2026-09-18T18:36:26.771Z"
updated: "2026-09-29"
author: "RiGeBa Lighting Team"
category: "How-To"
image: "assets/images/products/rg-ml600wr-kose12h58.jpg"
imageAlt: "12x40W RGBW LED moving head wash light"
excerpt: "A 16A circuit does not take 14 moving heads. How to size power, cable and chain length for a moving-head rig without tripping on load-in."
tags:
  - moving heads
  - power
  - cabling
  - daisy-chaining
faq:
  - "How many moving heads fit on one 16A circuit?::Do the arithmetic, then derate. A 300W fixture at 230V draws about 1.3A nominally, so twelve would be 15.6A — too close. Derating to 80 percent of the breaker gives 12.8A, or nine fixtures. At 120V the same fixture draws about 2.5A and only five fit."
  - "Can I daisy-chain power between moving heads?::Only if the fixtures are rated for it with proper through-connectors. A DMX daisy chain is always fine; a mains daisy chain is not, and mixing the two habits is how rigs end up with burned connectors. Check the fixture rating before chaining mains."
  - "Why does the breaker trip when the rig powers up, not during the show?::Inrush. LED drivers and switch-mode supplies draw a brief surge on power-up far above their running current. Staggering the rig on in groups, or using a sequencer, removes almost all of it."
  - "What cable gauge does a moving-head rig need?::Size by current and run length, not by habit. A long run at high current drops voltage, and a fixture rated AC110-240V tolerates more drop than a fixed-voltage one. Once a run exceeds about 20 m, calculate the drop rather than assuming."
  - "Is it worth buying a lower-wattage fixture to save power budget?::Only if you were going to buy it anyway. Power budget usually costs less than the output you give up. In our range a 1x150W beam is US$96 and a 1x500W BSW is US$569, and they are different products, not two sizes of one."
---

Field-day power failures are almost never a single dramatic fault. They are a chain of small assumptions: rated watts treated as running current, a breaker treated as a target rather than a limit, and a mains chain treated like a DMX chain because the connectors look similar.

## The short answer

Divide each fixture's rated power by the supply voltage to get nominal current, add a quarter for power factor and losses, then load the circuit to no more than 80 percent of the breaker. At 230V that is roughly nine 300W moving heads on a 16A circuit; at 120V it is roughly five. Stagger power-up in groups to avoid inrush trips, and never chain mains between fixtures unless the fixture is rated for it.

## How do I size a circuit for moving heads?

The arithmetic is simple, and the derating is what people skip.

| Fixture power | Nominal current at 230V | Nominal current at 120V | On a 16A / 230V circuit (80%) |
|---|---|---|---|
| 150W | 0.65A | 1.25A | 19 fixtures |
| 300W | 1.30A | 2.50A | 9 fixtures |
| 500W | 2.17A | 4.17A | 5 fixtures |
| 720W | 3.13A | 6.00A | 4 fixtures |
| 1000W | 4.35A | 8.33A | 2 fixtures |

Two caveats on that table. First, LED drivers have a power factor below one, so actual current is higher than the ideal figure — budget a quarter more. Second, inrush on power-up can exceed running current several times over, which is why a circuit that is fine for a show can trip when the rig comes on.

## Why does the breaker trip on power-up?

Because every switch-mode supply in the rig charges at once. Twenty LED drivers each drawing a brief surge add up to a spike the breaker sees as a fault.

Three fixes, in order of effectiveness:

1. **Stagger power-up** in groups of four to six fixtures, a second apart.
2. **Split the rig across more circuits** so no single breaker takes the whole inrush.
3. **Use a sequencer** or a power distribution unit with delayed outputs on larger rigs.

If the rig trips on power-up but runs all night, inrush is the diagnosis. If it trips after an hour, you have a genuine thermal overload and need to recalculate.

## Can mains be daisy-chained like DMX?

No, not by default. The two look similar — both may use PowerCON-style connectors — but the rules are entirely different.

- **DMX** is designed to be daisy-chained, up to 32 units electrically, eight to twelve in practice.
- **Mains** may be chained only where the fixture provides a rated through-connector, and only up to that fixture's stated limit.

The habit worth building: label the mains chain separately from the data chain, and check every fixture in the chain is rated for the total current passing through it. The first fixture in a chain carries the current of everything downstream of it, and its connector is the one that fails.

## Which moving heads belong on which circuit?

Real configurations from our current range, with the current figures they imply:

| Model | Configuration | EXW, 1 unit | Nominal current at 230V |
|---|---|---|---|
| [RG-ML150BR-KNNW1H13](/products/moving/rg-ml150br-knnw1h13) | 1x150W | US$96 | 0.65A |
| [RG-ML300BR-KN1H17](/products/moving/rg-ml300br-kn1h17) | 1x300W, 3-in-1 BSW | US$315 | 1.30A |
| [RG-ML500RS-KNNW1H20](/products/moving/rg-ml500rs-knnw1h20) | 1x500W, 3-in-1 BSW | US$569 | 2.17A |
| [RG-ML720BL-KCRe12AH179](/products/moving/rg-ml720bl-kcre12ah179) | 12x60W RGBW wave bar | US$470 | 3.13A |
| [RG-ML420WC-KCH93](/products/moving/rg-ml420wc-kch93) | 7x60W IP65 outdoor | US$590 | 1.82A per unit at rated output |

Multi-source fixtures are the ones that surprise people: a 12×60W bar is one unit on the truss but 720W on the circuit, and four of them plus a wash set will exhaust a 16A supply well before the rig looks full.

## What cable and connector rules matter?

- **Size by current and length.** Voltage drop over a long run is real, and a fixture rated AC110-240V is far more tolerant of it than a fixed-voltage unit.
- **Keep mains and data separated** in the loom, and label both ends of every run.
- **Use the correct connector rating** for the current passing through it, including through-connectors on fixtures.
- **Do not use domestic extension leads** on a rig, even indoors and even briefly.
- **Check the earth** on every run. Moving heads have metal yokes and move; a missing earth is not a theoretical risk.

## What should be on the load-in checklist?

1. Circuit count and which fixtures go on each.
2. Power-up order, in groups.
3. Cable gauge per run, with the longest run calculated rather than assumed.
4. Earth continuity on every run.
5. A spare breaker and a spare power cable of each length in use.

## What does a load-in power check look like?

Twenty minutes at the start of the day prevents most field failures. Work in this sequence:

1. **Confirm the supply** at the point you will use, with a meter, not by reading a label.
2. **Test earth continuity** on every run that will carry a metal fixture.
3. **Power up in groups** of four to six and watch the breaker, noting which group trips if any does.
4. **Measure current** on the fully loaded circuit once the rig is running, and compare it against your calculation rather than against the breaker rating.
5. **Feel the connectors** after thirty minutes of running. Warm is normal; hot is a fault.
6. **Repeat the check** on the second day of a multi-day job, because a connector that was fine on load-in can loosen overnight.

A clamp meter and a socket tester cost less than one replacement fixture.

## What to send us

Send the fixture list with rated power for each model, the supply voltage at the venue, and the number and rating of available circuits. We will return the maximum fixtures per circuit, a power-up grouping and the cable gauge for each run length — plus, if the rig is still being specified, the current draw of any model in our [moving head range](/products/moving/rg-ml300br-kn1h17) before you commit to a quantity.
