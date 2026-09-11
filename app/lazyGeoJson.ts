type CollectionLike = {
  type: "FeatureCollection";
  features: unknown[];
};

type SourceLike<Collection extends CollectionLike> = {
  setData: (data: Collection) => void;
};

type ResponseLike = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type LoaderOptions<Key extends string> = {
  files: Partial<Record<Key, string>>;
  labels: Record<Key, string>;
  fetcher?: (url: string) => Promise<ResponseLike>;
  basePath?: string;
};

export function createLazyGeoJsonLoader<
  Key extends string,
  Collection extends CollectionLike,
>({
  files,
  labels,
  fetcher = fetch,
  basePath = "data/layers",
}: LoaderOptions<Key>) {
  const cache = new Map<Key, Collection>();
  const requests = new Map<Key, Promise<Collection>>();
  const hydrated = new Set<Key>();

  const prime = (datasets: Partial<Record<Key, Collection>>) => {
    for (const [rawKey, dataset] of Object.entries(datasets) as [Key, Collection | undefined][]) {
      if (dataset) cache.set(rawKey, dataset);
    }
  };

  const ensure = async (
    key: Key,
    getSource: (key: Key) => SourceLike<Collection> | undefined,
  ) => {
    let dataset = cache.get(key);
    if (!dataset) {
      let request = requests.get(key);
      if (!request) {
        const filename = files[key];
        if (!filename) throw new Error(`${labels[key]}の地図データがありません`);
        request = fetcher(`${basePath}/${filename}`).then(async (response) => {
          if (!response.ok) throw new Error(`${labels[key]}を読み込めませんでした`);
          const value = await response.json() as Partial<CollectionLike>;
          if (value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
            throw new Error(`${labels[key]}の地図データが不正です`);
          }
          return value as Collection;
        });
        requests.set(key, request);
      }
      try {
        dataset = await request;
        cache.set(key, dataset);
      } finally {
        if (requests.get(key) === request) requests.delete(key);
      }
    }

    if (!hydrated.has(key)) {
      const source = getSource(key);
      if (!source) throw new Error(`${labels[key]}の表示準備ができていません`);
      source.setData(dataset);
      hydrated.add(key);
    }

    return dataset;
  };

  const reset = () => {
    cache.clear();
    requests.clear();
    hydrated.clear();
  };

  return { ensure, prime, reset };
}
