const MAX_SPEED_KMH = 80;
const MAX_JUMP_KM = MAX_SPEED_KMH / 3600;

export function interpolateAngle(prevAngle, nextAngle, t) {
  let diff = (nextAngle - prevAngle) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return (prevAngle + diff * t + 360) % 360;
}

export function interpolatePosition(prevPos, nextPos, prevTime, nextTime, currentTime) {
  if (!prevPos || !nextPos) return nextPos || prevPos;
  const duration = nextTime - prevTime;
  if (duration <= 0) return nextPos;

  const t = Math.min(1, Math.max(0, (currentTime - prevTime) / duration));

  const dlat = nextPos[0] - prevPos[0];
  const dlng = nextPos[1] - prevPos[1];
  const degDist = Math.sqrt(dlat * dlat + dlng * dlng);
  const kmDist = degDist * 111;

  if (kmDist > MAX_JUMP_KM * duration) {
    return nextPos;
  }

  const smoothT = t * t * (3 - 2 * t);

  return [
    prevPos[0] + dlat * smoothT,
    prevPos[1] + dlng * smoothT,
  ];
}

export function createShipInterpolator() {
  const shipStates = new Map();

  return {
    update(ships, timestamp) {
      for (const ship of ships) {
        const prev = shipStates.get(ship.shipId);
        shipStates.set(ship.shipId, {
          prevPos: prev?.nextPos || ship.position,
          nextPos: ship.position,
          prevHeading: prev?.nextHeading ?? ship.heading ?? 0,
          nextHeading: ship.heading ?? 0,
          prevTime: prev?.nextTime || timestamp - 1000,
          nextTime: timestamp,
          speed: ship.speed,
        });
      }
    },

    getState(shipId, currentTime) {
      const s = shipStates.get(shipId);
      if (!s) return null;
      const duration = s.nextTime - s.prevTime;
      const t = duration > 0 ? Math.min(1, Math.max(0, (currentTime - s.prevTime) / duration)) : 1;
      const smoothT = t * t * (3 - 2 * t);
      
      const pos = interpolatePosition(s.prevPos, s.nextPos, s.prevTime, s.nextTime, currentTime);
      const heading = interpolateAngle(s.prevHeading, s.nextHeading, smoothT);
      return { pos, heading };
    },

    getPosition(shipId, currentTime) {
      const state = this.getState(shipId, currentTime);
      return state ? state.pos : null;
    }
  };
}
