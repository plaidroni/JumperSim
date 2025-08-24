# 'State' of disarray

Trying to think in React, we need to plot out where state is living.

- I started running into an issue where changing some of the jumper state (specifically `leva`) through panels was causing jumpers to rerender, or just disappear...
- How to model time? There needs to be an authoritative time, and Jumpers shouldn't desync with time