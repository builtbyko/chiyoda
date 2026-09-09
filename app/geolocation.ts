type PositionFeature = {
  type: "Feature";
  properties: { accuracy: number };
  geometry: {
    type: "Point" | "Polygon";
    coordinates: [number, number] | [number, number][][];
  };
};

type PositionCollection = {
  type: "FeatureCollection";
  features: PositionFeature[];
};

const METERS_PER_LATITUDE_DEGREE = 111_320;

export function buildLocationData(
  longitude: number,
  latitude: number,
  accuracyMeters: number,
): {
  point: PositionCollection;
  accuracyArea: PositionCollection;
  bounds: [[number, number], [number, number]];
} {
  const accuracy = Number.isFinite(accuracyMeters) ? Math.max(accuracyMeters, 0) : 0;
  const cameraRadius = Math.max(accuracy, 25);
  const latitudeRadius = cameraRadius / METERS_PER_LATITUDE_DEGREE;
  const longitudeScale = Math.max(Math.cos(latitude * Math.PI / 180), 0.01);
  const longitudeRadius = cameraRadius / (METERS_PER_LATITUDE_DEGREE * longitudeScale);

  const point: PositionCollection = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { accuracy: Math.round(accuracy) },
      geometry: { type: "Point", coordinates: [longitude, latitude] },
    }],
  };

  const ring: [number, number][] = [];
  if (accuracy > 0) {
    const accuracyLatitudeRadius = accuracy / METERS_PER_LATITUDE_DEGREE;
    const accuracyLongitudeRadius = accuracy / (METERS_PER_LATITUDE_DEGREE * longitudeScale);
    for (let index = 0; index <= 48; index += 1) {
      const angle = index / 48 * Math.PI * 2;
      ring.push([
        longitude + Math.cos(angle) * accuracyLongitudeRadius,
        latitude + Math.sin(angle) * accuracyLatitudeRadius,
      ]);
    }
  }

  const accuracyArea: PositionCollection = {
    type: "FeatureCollection",
    features: ring.length > 0 ? [{
      type: "Feature",
      properties: { accuracy: Math.round(accuracy) },
      geometry: { type: "Polygon", coordinates: [ring] },
    }] : [],
  };

  return {
    point,
    accuracyArea,
    bounds: [
      [longitude - longitudeRadius, latitude - latitudeRadius],
      [longitude + longitudeRadius, latitude + latitudeRadius],
    ],
  };
}

export function geolocationErrorMessage(code: number): string {
  if (code === 1) return "位置情報が許可されていません。ブラウザの設定から許可してください。";
  if (code === 2) return "現在地を取得できませんでした。通信環境を確認して、もう一度お試しください。";
  if (code === 3) return "現在地の取得がタイムアウトしました。もう一度お試しください。";
  return "現在地を取得できませんでした。もう一度お試しください。";
}
