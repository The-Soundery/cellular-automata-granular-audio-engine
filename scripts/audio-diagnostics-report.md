# Audio diagnostics (post-fix)


## A — Mixed field: 8 stable long + 24 chaotic short (philosophy case)
{
  "stableMeanTrigHz": 10.1875,
  "chaoticMeanTrigHz": 43.5,
  "stableMeanDuty": 0.9900793650793651,
  "chaoticMeanDuty": 0.997830687830688,
  "minTrig": 20,
  "maxTrig": 87,
  "totalDeferred": 0,
  "blocksWithDeferPct": 0,
  "desiredStableHz": 10.061601642710473,
  "desiredChaoticHz": 43.32023575638507
}

## B — All-due monopoly check (round-robin fairness)
{
  "triggersFirst4": [
    37,
    37,
    37,
    37
  ],
  "triggersLast4": [
    36,
    36,
    36,
    36
  ],
  "minTrig": 36,
  "maxTrig": 37,
  "ratioMaxMin": 1.0277777777777777
}

## C — Interval philosophy (stable sparse vs chaotic dense)
{
  "name": "stable",
  "grainSamples": 5292,
  "interval": 4383,
  "effectiveHz": 10.06,
  "triggersPerSecIf32": 322
}
{
  "name": "mid",
  "grainSamples": 2646,
  "interval": 2262,
  "effectiveHz": 19.5,
  "triggersPerSecIf32": 623.9
}
{
  "name": "chaotic",
  "grainSamples": 882,
  "interval": 830,
  "effectiveHz": 53.13,
  "triggersPerSecIf32": 1700.2
}

## D — Bin gains attenuate-only (no boost)
{
  "maxGain": 1,
  "minGain": 1,
  "binsBoosted": 0,
  "peakInQuietBin": 0.000123,
  "rmsQuietBin": 0.000005,
  "rmsLoudBin": 0.0439
}

## E — test-tone.wav bins
{
  "maxGain": 1,
  "binsBoosted": 0,
  "rmsMin": 0.00001,
  "rmsMax": 0.2662
}
