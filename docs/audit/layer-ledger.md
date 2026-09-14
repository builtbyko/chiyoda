# CHiYODA ATLAS レイヤー台帳

精査日：2026-09-14（日本時間）。基準main：`4b0cecfbf47fcfec6f10f046189280ff113f9fa6`。

既存コード、生成済みデータ、保存済み原資料のオフライン精査。27個の表示レイヤーに対し、読み込むGeoJSONは25ファイル・7,434地物。基準データの検索索引は2,078件。共有データを別の切り口で表示するため、各行の件数を合算しても7,434にはならない。タイル配信の地物件数は今回数えていない。

この台帳は基準mainのデータを記録し、今回の修正後の表示・再生成方法を併記する。原資料の現時点での最新性、地図上での操作感、敷地単位の法令適用は確認していない。機械検査の実行時点・対象ファイルhashは `scripts/data/atlas-data-audit.json` に記録される。作業ツリーの検査結果と基準コミットの同一性は別途区別する。

現行UIのメニュー順は、都市計画 → 再開発・まちづくり → 地域・歴史 → 土地利用・規制 → 交通・公共空間 → 都市構造 → 統計・参考 → 防災。この台帳の表順とは異なる。全27行は既存ON/OFFトグルに見た目を統一し、6種類のAreaLayerは排他選択・再クリックOFFを維持。背景は最新航空写真を初期表示にし、右上でOSM・淡色地図・最新／歴史航空写真を切り替える。

追記（2026-09-14）：基準27レイヤーに「坂」を1つ追加し、現在28トグル。坂54地点の取得・除外根拠は `scripts/data/slopes-build-report.json` に記録。上記の基準main件数は過去の精査範囲として保持する。

## 日付・件数の読み方

- **資料基準日**：統計の基準日、GIS収録年度、公式ページが述べる情報時点。ページ更新日と実地の現況日は同じとは限らない。
- **取得日**：公式サイトから原レスポンスを実際に取得した日。実取得の記録がない場合は「不明」とする。キャッシュファイルの更新日時や再生成日から推定しない。
- **整理日**：ATLASが保存資料から生成・整理した日。再開発データの `compiledDate` はこれであり、取得日でも全案件の最新確認日でもない。
- **件数**：生成GeoJSONの地物行数。団体区域数は団体数ではなく、都市計画道路の結合線数は路線数ではない。
- **6区**：千代田区、中央区、港区、新宿区、文京区、台東区。千代田区限定レイヤーでは、周辺5区が空白でも「資源が存在しない」とは読まない。

## 再生成とキャッシュ更新条件

台帳のR番号は以下の手順を指す。大量の原ZIP、PDF、HTML、SHP、GeoPackageはGitへ追加しない。

| 系統 | スクリプト・入力 | キャッシュ更新条件／注意 |
|---|---|---|
| R1 基礎 | `fetch_map_sources.py` → `build_map_data.py` → `normalize_geojson.py`。原資料：`../work/chiyoda_map/data` | fetchは既存ファイルを再利用し、指定の `--force` で再取得。人口・境界・OSM等すべての原入力を取得するスクリプトではない。年度付き入力を差し替える場合、builderの固定時点・出典も合わせて確認。基礎再生成は検索索引も更新する。 |
| R2 千代田公式GIS | `prepare_chiyoda_official_layers.py`。原ZIP：`../work/chiyoda_map/data/chiyoda/official-layers` | 既存ZIPがあれば再利用し、force機能はない。更新時は対象ZIPの公式版を確認してキャッシュを更新してから実行する。通常の再実行は最新取得を意味しない。生成時に文化資源の検索索引を同期する。 |
| R3 OSM歩行 | `build_underground_network.py`。原レスポンス：`../work/chiyoda_map/data/next-stage/osm` | 実行のたびOverpassへ取得する。現在のreportは取得日を保存しないため、再取得したら取得日を別途記録する。今回パネルの裏付けのない固定取得日を「未記録」へ修正。町丁目・駅から欠落情報を補完しない。 |
| R4 地区内部区分 | `fetch_district_plan_subareas.py`。原レスポンス・探索報告：`../work/chiyoda_map/data/next-stage/planning` | 実行時に公式ArcGISを照会し、対象ID・属性・件数・ポリゴンの安全条件を確認して生成。保存済み原レスポンスを今回の精査に使用。内部区分が特定できない場合は推測生成しない。 |
| R5 地域方針 | `build_planning_movements.py`。`scripts/data/planning-movements-registry.json` ＋ `towns.json` | ネット取得なし。同梱6案件のregistryが情報源。更新は各公式資料を確認して状態・基準日・出典をregistryへ記録してから生成。町丁目境界変更でも代表点が変わる。 |
| R6 再開発 | `build_urban_change_projects.py`。原HTML／住所検索：`../work/chiyoda_map/data/next-stage/urban-change/pages`・`geocode` | HTMLは既存キャッシュを再利用し `--force` で再取得。住所検索は既存キャッシュを再利用。今回、実際に取得したHTMLには `.fetch.json` のURL・取得日を保存する仕組みを追加。記録のない既存キャッシュには取得日を付けない。整理日は `compiledDate`、原資料時点は `sourceDate`、確認できた実取得のみ `retrievedDate`。生成時に検索索引も同期。 |
| R7 景観指定一覧 | `build_reference_snapshot.mjs` → R1 → R2。入力：公式一覧HTML・公式点GeoJSON | 一覧の指定番号・正式名・所在地・指定日・個別資料を確認して `scripts/data/landscape-important-properties.json` を更新。R2では既存の `landscape-properties.json` と公式GISを名寄せするため、更新順と既存点の根拠を保持。 |
| T1 背景・陰影タイル | `app/MapAtlas.tsx` の地理院背景／陰影raster、OSM背景raster | 閲覧時に直接取得。ローカル保存・GeoJSON化なし。タイル取得日は原地形・地物の現況日ではない。背景は1種類ずつ表示。OSM背景はOpenStreetMap参考で、選択中は出典リンクを地図右上に表示。 |
| T2 建物高さタイル | `app/MapAtlas.tsx` のindigo-lab vector MVT | 初回ONから直接取得。2020年度版で、閲覧日による自動最新化はない。第三者配信の継続性・仕様変更は別途確認。巨大CityGMLは取得しない。 |

## 土地利用・規制

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 用途地域（zoning） | 建て方の基本指定。6区 | `zoning.json`：967面、千代田85面 | 2025年度、東京都2026-07-01修正版／取得日不明 | [S05][s05]・公式GIS | 区境界切出し、6色へ分類、正式名・FAR・BCR保持。約0.4m簡略化・6桁座標。敷地の実効値は算定しない | R1。公式原版と固定年度の両方を更新 |
| 実土地利用（landUse） | 現実の用途の町丁目構成。6区 | `towns.json`：658面、千代田115面 | 2021年度調査＋境界2020／取得日不明 | [S03][s03]＋[S04][s04]・派生データ | 元画地の町丁目名・面積で集約。交通・水面等を除く主用途を色表示。構成上位2種を保持。元画地形状は配信しない | R1。調査年度・町丁目対応を確認 |
| 防火指定（fire） | 防火・準防火の指定。6区 | `fire.json`：226面、防火108・準防火118 | 2025年度、東京都2026-07-01修正版／取得日不明 | [S05][s05]・公式GIS | 区切出し、約0.4m簡略化・6桁。法令判断は原指定図で確認 | R1。公式原版と固定年度の両方を更新 |

## 交通・公共空間

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 鉄道・駅（rail） | 鉄道の連続性と乗換拠点。6区 | `rail.json`：32線／`stations.json`：141点、千代田駅24点 | 2025-12-31／取得日不明 | [S07][s07]・公式GIS由来 | 路線×事業者で線結合。同名駅の駅線範囲を合わせたbbox中心が駅代表点。出口位置ではない | R1。原N02版と駅名集約を確認 |
| 主要道路（roads） | 街の軸・道路の連続性。6区 | `roads.json`：751線地物 | 元OSMの地物時点不明／2026-08-30取得と既存metaに記載、実取得履歴未照合 | [S08][s08]・[S09][s09]・OpenStreetMap参考 | motorway～tertiaryを4分類、名称×分類×refで結合・区切出し。法令上の道路種別・管理者ではない | R1。PBF更新と取得日を別途記録 |
| 駅出入口（stationEntrances） | 出口の位置と取得済み属性。千代田区付近 | `station-entrances.json`：243点 | OSM各地物時点不明／取得日未記録（旧パネル固定日を修正） | [S08][s08]・OpenStreetMap参考 | subway_entrance等の取得点、区境界約5mバッファ内。zoom14以上。駅名・事業者は元タグのみ | R3。毎回取得、取得日記録が必要 |
| 地下歩行リンク（undergroundWalkways） | 地下・屋内の歩行リンク。千代田区 | `underground-walkways.json`：1,357線片 | OSM各地物時点不明／取得日未記録（旧パネル固定日を修正） | [S08][s08]・OpenStreetMap参考 | 地下footway・屋内corridor・負layer等。区切出しでwayが分割される。網羅性・開放時間・現在の通行可否は不明 | R3。毎回取得、欠落通路の補完なし |
| 公園・緑地（parks） | 緑地のまとまりと連続性。6区 | `parks.json`：735面、千代田単独63面＋跨区 | 2026-02-02公開ファイル。実地時点不明／取得日不明 | [S10][s10]・公式GIS由来 | 名称×分類×関係区×種別×所管で面結合・切出し。属性面積は同グループ最大値で表示面積と別 | R1。原ファイル版・所管・面積定義を確認 |
| 公開空地（openSpaces） | どこに開かれた空間が載るか。千代田区 | `open-spaces.json`：173面 | 公式公開ページ2025-06-06更新。GIS現況日不明／取得日不明 | [S11][s11]・公式GIS | WGS84変換・属性別名・妥当性正規化・6桁。利用条件・時間は非収録。別制度の同一面も保持 | R2。既存ZIP再利用、更新版確認後に再生成 |

## 都市構造

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 地形・陰影（terrain） | 台地・谷・崖の連続性。地理院配信範囲 | raster：`hillshademap`、件数対象外 | 原標高の時点は今回未確認／閲覧時取得 | [S12][s12]・公式タイル、標高からの派生 | z2～16、opacity0.34。陰影であり標高数値は示さない | T1。直接取得、ローカル保存なし |
| 坂（slopes） | 坂名と地形・街の歴史。千代田区中心 | `slopes.json`：54地点（約45KB） | 区一覧更新2023-03-08／協会地点2026-09-14実取得 | [千代田区の坂案内](https://www.city.chiyoda.lg.jp/koho/kuse/gaiyo/yokoso/saka.html)＋[千代田区観光協会](https://visit-chiyoda.tokyo/app/spot?searchSubCategory%5B0%5D=16)・公式資料をATLASで整理 | 協会公開ページのq座標を保持。坂の区間・勾配ではない。昌平坂のみ区境の公式記載に基づく10m以内の位置検証例外。永井坂・胸突坂は住所と点が矛盾し除外、観音坂は地点未掲載。初期OFF、点z13・名z14以上 | `build_slopes.py`。原HTML・実取得記録は `next-stage/slopes`。通常はキャッシュ再利用、`--refresh`のみ再取得。位置・名称が不明なら推測補完しない。同名の検索表示は所在地町名を添える |
| 建物高さ（buildingHeight） | 市街地の高さ構造。東京都23区配信範囲 | vector MVT：`bldg.measuredHeight`、件数対象外 | 2020年度／閲覧時取得 | [S13][s13]・PLATEAUからの派生、indigo-lab第三者配信 | z10～16の2D色分け。広域で小規模建物省略。高さ不明はpopupで区別するが色式は0mと同色。最新建物・高さ規制ではない | T2。2020版のまま、巨大原データ取得なし |
| 町丁目境界（boundaries） | 統計の基礎単位。6区 | `towns.json`：658面、千代田115面 | 2020国勢調査／取得日不明 | [S04][s04]・派生データ | 改称対応、同名面結合、約0.2m簡略化。水面調査区は除外。法的敷地境界ではない | R1。新境界へ変更時は全統計join・7地域を確認 |

## 都市計画

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 地区計画（districtPlans） | 地区計画区域と内部区分。外枠6区、内部千代田区 | `district-plans.json`：通常117面、千代田36面／共有`special-zones.json`の再開発等促進区付き59面／`district-plan-subareas.json`：181面・40計画 | 通常外枠2025-05-02、促進区系metaは2024～2025の複数時点、内部は各最終決定日属性／内部2026-09-13取得と既存報告に記載、外枠取得不明 | [S06][s06]＋[S16][s16]・公式GIS | 今回通常＋促進区付き外枠を同toggleで表示。内部空区分5行除外、zoom14以上・名16以上。通常／促進の同名2組は原資料上の差として保持。特例ON時は促進専用追加外枠OFFで同sourceの二重描画回避 | 外枠R1、内部R4。元区分と時点を別々に確認 |
| 都市計画道路（urbanPlanningRoads） | 計画線と周辺関係。6区 | `urban-planning-roads.json`：24結合線、千代田5。current／priority空間ファイル未生成 | PLATEAU2020年度／取得日不明。第五次表2026-08-31公表・2026-09-13取得 | [S14][s14]・公式GIS由来／[S15][s15]・公式表 | 区×分類で結合、立体構想除外、約1m簡略化。路線名・幅員・現行整備状況は元にない。第五次の放射9号は表の参考情報のみ | R1。現行探索は`upgrade_urban_planning_roads.py`、原キャッシュ`next-stage/urban-planning-roads`。安全条件未達なら既存線維持 |
| 高度地区（heightDistricts） | 種別・数値指定。隣接4区 | `height-districts.json`：584面。千代田・中央は元データ指定なし | 2025-03-31とmetaに記載／取得日不明 | [S06][s06]・公式GIS | 種別・最低／最高数値の4分類、切出し・簡略化。千代田・中央の最新指定なし判断は今回外部再確認していない | R1。元版と無指定／データ欠落の区別を確認 |
| 都市計画の特例（容積・再開発等）（specialZones） | 制度の重なり。6区 | `special-zones.json`：232面、千代田49。高度利用64・促進区系59・特定街区58・都市再生特別地区51 | 2024-11-11～2025-03-31とmetaに記載／取得日不明 | [S06][s06]・公式GIS | 制度ごとに属性整理・切出し。促進区付き地区計画は地区計画toggleとも共有。重なりから実効容積率・高さを計算しない | R1。各制度の個別時点・属性を確認 |

## 再開発・まちづくり

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 再開発・大規模建替え（redevelopment） | 物理的更新・提案と規模。千代田主役＋隣接区背景 | `urban-change-projects.json`：77点。千代田含む48＝市街地7＋建替40＋提案1、隣接29 | `sourceDate`は各原資料時点、隣接2025-10-31。`compiledDate`は整理日／実取得の`.fetch.json`があるURLのみ取得日。過去一律`retrievedDate`は除去 | [S17][s17]・[S18][s18]・[S19][s19]・公式資料をATLASで整理 | 住所検索参考41点、既存町丁目代表35点、提案町丁目代表1点。敷地・施行区域ではない。カテゴリ・面積のzoom別点、大型区内label、隣接減衰を維持。竣工予定は完成判定に使わない | R6。HTML更新・位置キャッシュ・整理日を区別し索引同期 |
| 地域まちづくり（検討・方針）（planningMovements） | ルール形成・地域協議・方針検討。千代田区 | `planning-movements.json`：6点 | 同梱registry各`sourceDate`／原資料取得日不明。registry更新日と別 | registry各千代田公式URL・公式資料をATLASで整理 | 町丁目`representative_point()`。神保町・錦町は丁目未特定で任意二丁目参考点。事業敷地・対象区域ではない | R5。公式根拠を確認してregistry更新。自動一覧拡張なし |
| エリアマネジメント・まちづくり団体（areaManagement） | 誰がどこで活動するか。千代田区 | `area-management.json`：12区域、複数団体を含む | 公式ページ2025-06-06更新。GIS現況日不明／取得日不明 | [S11][s11]・公式GIS | 団体名1～4・活動分類を保持した区域。12は団体数ではない。法定区域と区別 | R2。既存ZIP再利用、更新版確認後に再生成 |

## 地域・歴史

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 千代田区の7地域（chiyodaRegions） | 政策・まちづくり上の地域。千代田区 | `chiyoda-regions.json`：7面 | マスタープラン2021-05＋境界2020／取得日不明 | [S20][s20]＋[S21][s21]＋[S04][s04]・派生データ | 公式町丁目対応表で115町丁目を結合。割当漏れ・重複チェックあり。labelは面内代表点。元図そのもののデジタイズではない | R1。`scripts/data/chiyoda-regions.json`と新境界の対応確認 |
| 都市機能・文化の界隈（functionalKaiwai） | 古書店街・学生街・電気街等の集積。千代田区 | `functional-kaiwai.json`：16面 | 公式ページ2025-06-06更新。GIS現況日不明／取得日不明 | [S11][s11]公式GIS「界隈」・公式GIS | 公式16面をWGS84・精度正規化。12景観界隈とは別。欠落区域を町丁目等から補完しない | R2。既存ZIP再利用、更新版確認後に再生成 |
| 歴史・文化資源（culturalAssets） | 文化財・景観指定・保存プレート。千代田区 | `cultural-assets.json`：111点＝国23・都17・区7・景観64／`memory-plates.json`：23点、合計134行 | GISページ2025-06-06更新、景観一覧2024-12（ページ2026-02-05更新）。個別指定日属性あり／実取得日不明 | [S11][s11]＋[S22][s22]＋[S23][s23]・公式GIS／公式資料をATLASで整理 | 2dataset同時lazy-load。景観の複数指定は名寄せ、文化財の別指定は保持。景観追加8点は住所由来街区参考点。保存プレートの元誤記「里見?」は確認済み正式名「里見弴」へ生成時も限定補正 | R2＋R7。元ZIPだけでなく指定一覧・既存点の更新順を確認 |

## 統計・参考

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 住民密度（population） | 住む人の分布。6区 | 共有`towns.json`：658面、千代田115面 | 人口2026-01-01＋境界面積2020／取得日不明 | [S01][s01]・公式統計／[S04][s04]。密度は派生データ | 住基人口をCODH町丁目面積で割る概算。町丁目の統計面積と区情報パネルの面積は別定義 | R1。人口原表・町丁目対応・時点を一緒に確認 |
| 昼間人口（daytime） | 働く・学ぶ人の集積。6区 | 共有`towns.json`：658面、千代田115面 | 2020国勢調査による昼間人口推計／取得日不明 | [S02][s02]・公式統計・公式表由来 | 小地域IDで重複除外・町丁目集約。密度は原表小地域面積から再計算。2026住民との増減比較不可 | R1。原表の小地域・推計定義・集約を確認 |
| 地価公示（landPrices） | 標準地の価格差。6区 | `land-prices.json`：383点、千代田59点 | 2026-01-01／取得日不明 | [S24][s24]・公式統計・公式表／公式GIS由来 | 原標準地点を切出し、価格・前年比・利用・駅距離等選定。任意敷地の査定値ではない | R1。年度・価格列・前年比定義を確認 |

## 防災

| レイヤー（内部key） | 何を見るか・範囲 | ファイル・件数 | 資料時点／取得日 | 出典・データ性格 | 加工・位置の意味 | 再生成・更新条件 |
|---|---|---|---|---|---|---|
| 洪水浸水（flood） | 想定最大規模の深さ分布。6区 | `flood.json`：4深さ別MultiPolygon | 2025年度（2026-05更新）とmetaに記載／取得日不明 | [S25][s25]・公式GIS由来、最大深面は派生データ | 河川別想定面を結合し各地点最深の排他的面を生成、約1m簡略化。4は河川数ではない。現在の災害状況ではない | R1。想定区分・河川範囲・深さの集約確認 |
| 指定避難所（shelters） | 掲載施設の概略位置。6区 | `shelters.json`：374点、千代田15点 | 施設別更新日不明／2026-09-07取得と既存metaに記載、実取得履歴未照合 | [S12][s12]のsih／sfh・公式GIS由来 | タイル抽出、一般／福祉別、名称×住所×区分×座標で重複除去。現在の開設・受入を示さない | R1。原タイル・取得日と各区の案内を別に確認 |

## 共有データ・表示の維持事項

- AreaLayerの6種類（用途・土地利用・防火・洪水・住民・昼間）はセクションを跨いでも排他選択。選択中の再クリックでnoneに戻り、「表示なし」専用ボタンは置かない。
- 地区計画内部区分は独立toggleにせず、外枠と同じtoggleで高zoomだけ表示する。再開発等促進区付き地区計画を追加外枠として同じsourceから読む場合、特例側との重複表示を避ける。
- 歴史・文化資源は文化／景観ファイルと保存プレートファイルを別々に保持し、同toggleで同時lazy-loadする。旧`landscape-properties.json`は統合処理の入力で、独立表示しない。
- 旧`redevelopment.json`35点は隣接区保持・再生成の入力。表示・検索は`urban-change-projects.json`を使用し、旧データを二重に表示しない。
- 駅出入口・地下歩行リンク、陰影・建物高さを含む追加レイヤーは初期OFF。背景は最新航空写真デフォルトで、OSM・淡色地図と航空写真8時期の切替を維持。
- 検索対象とメニュー全レイヤーは同数ではない。基準索引は町丁目・駅・公園・地区計画外枠・特例・再開発・7地域・文化資源を収録。プレート・界隈・公開空地・団体等の未収録を地物欠落とは扱わない。
- 初期core索引と都市更新GeoJSONはHTTP再検証、その他は既定キャッシュ。ファイルの内容hashをURLへ反映する版同期は未導入で、個別更新時は索引と地物の同時公開を確認する。

## 今回確認した範囲と残る確認

### 全件機械確認

25個のactive GeoJSONで、Shapelyのgeometry妥当性・空形状と6区実区域との関係を検査。無効形状・空形状はいずれも0、ポイントの6区実区域外は0。検索のdataset／index／地物の対応、件数・座標の数値検査は `scripts/audit_atlas_data.mjs`、実区域・妥当性は `scripts/audit_atlas_geometry.py` と各生成報告に記録する。

`map-data.scope`はカメラ用bboxであり、実区域判定には使用しない。`wards.features`の6区ポリゴンunionを使う。strict coversでは多くの面・線に丸め／簡略化による微小はみ出しがある。町丁目42件計91㎡、用途128件593㎡、防火40件406㎡、洪水4件1,858㎡、地区通常外枠17件107㎡、内部2件1.99㎡、高度175件721㎡、特例7件68㎡、公園17件34㎡、7地域1件2.71㎡。線は道路71件計11.64m、鉄道26件11.35m、計画道路10件21.27m。これだけで区域の大幅誤りとは判断せず、境界許容差の確認対象として残す。

GeoJSONの `i` はすべてで安定IDを意味しない。通常地区計画では当初決定日、一部特例では年月日であり、同値の複数行はID重複と扱わない。公式SHPのIDも、同じZIP内の別SHPで再利用される場合がある。

### 保存済み一次データと全件照合した部分

- 千代田公式8ZIPのDBFレコード数。界隈16、公開空地173、団体12、保存プレート23、区文化財7、都文化財17、国文化財23、景観57原行を確認。景観は既存指定一覧64へ統合されるため単純な行数一致では比較しない。
- 保存プレート23件の原SHP点・PRJを読み、WGS84へ変換した座標が現GeoJSONと23／23で6桁一致することを確認。元DBFの「里見?」も確認し、既に指定された正式名への限定修正を再生成処理へ保存した。
- 区文化財7点・国文化財23点の元SHP座標を確認。異なる名称・指定の同一座標は原データ由来の例があるため、ATLASの変換ミスと断定しない。現地建物別の位置精度は未確認。
- 住民人口・世帯の町丁目合計は6区meta総数1,339,649人・808,859世帯に一致。全658町丁目で昼間密度が非null、土地利用主用途が収録される。

千代田の町丁目昼間人口合計は903,779人、区集計は903,780人で1人差。町丁目面積合計11.363527km²、区情報パネル11.66km²は昼間統計の区面積で定義が異なる。小地域集計・丸め・水面調査区等の影響を原表で追跡する余地があり、今回独自補正していない。

### 全件一次照合とは扱わない部分

通常地区計画と促進区付き地区計画、都市更新の原資料照合は個別精査結果・修正リストを参照する。元通常／促進の同名2組を一つに消す判断はしていない。GIS全レイヤーについて現在の公式版を取り直し、全属性・区域を公式図書と敷地単位で照合したわけではない。

同一geometry共有は文化資源10組、保存プレート5組、公開空地1組、避難所1組、地下リンク1組、都市更新4組。別指定・施設・参考点集約によるものを含む。今回、同点の存在を理由に地物を削除・位置移動しない。文化とプレートは同点の全件をクリックまとめ表示へ含めるよう修正し、既存23プレート全件の選択集合をテストした。

境界・人口joinの元全行、洪水の最大深集約、公園の面積定義、鉄道同名駅集約、全高度・防火指定、地価属性、各避難所の最新性、建物MVT・地理院タイルの原データ時点、OSMの網羅性は未解決項目。新しいデータを足す前に、この台帳の目的と位置・時点の定義に照らして個別に確認する。

## 出典リンク辞書と追跡先

下記URLは既存README・manifest・保存済み資料にある出典。2026-09-14にWebで再訪して最新性・リンク到達性を確認したものではない。

| ID | 一次出典／配信元 | 詳細な追跡先 |
|---|---|---|
| S01 | [東京都・住民基本台帳第5表][s01] | `../work/chiyoda_map/data/population-tokyo-2026-01.csv`、`build_map_data.py` |
| S02 | [東京都・2020昼間人口][s02] | `../work/chiyoda_map/data/daytime-population-2020/tj20zv1100.csv` |
| S03 | [東京都・令和3年区部土地利用現況][s03] | `fetch_map_sources.py`、`../work/chiyoda_map/data/land-use-tokyo-2021` |
| S04 | [CODH・国勢調査町丁字境界][s04] | `../work/chiyoda_map/data/towns-neighbors`、`build_map_data.py`の名称対応 |
| S05 | [国交省・都市計画決定GIS][s05] | `../work/chiyoda_map/data/urbanplanning`、`urban-planning-2025` |
| S06 | [東京都・都市計画決定情報GIS][s06] | `../work/chiyoda_map/data/planning-tokyo`、`fetch_map_sources.py`の各ZIP URL |
| S07 | [国土数値情報・鉄道N02-2025][s07] | `../work/chiyoda_map/data/rail`、`build_map_data.py` |
| S08 | [OpenStreetMap contributors／ODbL][s08] | 原PBF、OSM各featureの `_osm_id`・`_source_endpoint` |
| S09 | [BBBike東京抽出][s09] | `../work/chiyoda_map/data/Tokyo.osm.pbf`、`osmconf.ini` |
| S10 | [東京都・緑のオープンデータ][s10] | `fetch_map_sources.py`、`../work/chiyoda_map/data/green-tokyo-2026` |
| S11 | [千代田区・まちなかのウォーカブルな要素][s11] | `scripts/data/chiyoda-official-sources.json`の8ZIP、`chiyoda-official-layer-schema.json` |
| S12 | [国土地理院・地理院タイル一覧][s12] | `scripts/data/next-stage-source-manifest.json`、MapAtlasのtile URL |
| S13 | [indigo-lab・PLATEAU2020建築物MVT][s13] | `scripts/data/next-stage-source-manifest.json`、`next-stage/plateau/metadata` |
| S14 | [PLATEAU東京都23区2020・都市計画道路][s14] | `fetch_map_sources.py`の原ZIP URL、`../work/chiyoda_map/data/urban-planning-roads-plateau-2020` |
| S15 | [東京都建設局・第五次優先整備進捗][s15] | `scripts/data/road-upgrade-source-manifest.json`、`urban-planning-road-priority-metadata.json`、`urban-planning-road-upgrade-report.json` |
| S16 | [千代田区公式ArcGIS・地区計画layer6][s16] | `../work/chiyoda_map/data/next-stage/planning/district-plan-subareas-discovery.json`と原GeoJSON |
| S17 | [千代田区・事業中の市街地再開発][s17] | `scripts/data/urban-change-source-manifest.json`、`urban-change-build-report.json`、保存HTML |
| S18 | [千代田区・建築物環境計画書等一覧][s18] | 同manifest、各年度HTML、各点の `sourceUrl` |
| S19 | [東京都・都市計画提案図書][s19] | 同manifest、保存提案HTML、提案点の `proposalUrl` |
| S20 | [千代田区都市計画マスタープラン第4章][s20] | `scripts/data/chiyoda-regions.json` |
| S21 | [千代田区・地域と町丁目の公式対応][s21] | 同JSONの `officialMembershipUrl` と各towns |
| S22 | [千代田区・景観まちづくり重要物件一覧][s22] | `scripts/data/landscape-important-properties.json`、各点の個別公式PDF |
| S23 | [千代田区・まちの記憶保存プレート][s23] | 原`4_4_kiokuhozon.zip`、前処理の限定名称補正 |
| S24 | [国土数値情報・地価公示L01-2026][s24] | `fetch_map_sources.py`、`../work/chiyoda_map/data/land-price-2026` |
| S25 | [国土数値情報・洪水A31a-2025][s25] | `fetch_map_sources.py`、`../work/chiyoda_map/data/flood-2025` |

地域まちづくり6案件の公式URL・状態・基準日は `scripts/data/planning-movements-registry.json`、拡張方針は `planning-source-manifest.json`。未実装の12景観界隈・川沿い区域の探索は `landscape-kaiwai-metadata.json`、`river-source-schema.json` とリポジトリ外の探索報告に保持し、今回の27レイヤーへ含めない。

[s01]: https://www.toukei.metro.tokyo.lg.jp/juukiy/2026/jy26q10501.htm
[s02]: https://www.toukei.metro.tokyo.lg.jp/tyukanj/2020/tj-20index.htm
[s03]: https://www.toshiseibi.metro.tokyo.lg.jp/about/chousa/tochi_c/tochi_kekka_r3
[s04]: https://geoshape.ex.nii.ac.jp/ka/resource/
[s05]: https://www.mlit.go.jp/toshi/tosiko/toshi_tosiko_tk_000087.html
[s06]: https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d0000000028
[s07]: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html
[s08]: https://www.openstreetmap.org/copyright
[s09]: https://download.bbbike.org/osm/bbbike/Tokyo/
[s10]: https://catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000024
[s11]: https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/walkable/yoso-bumpujokyo.html
[s12]: https://maps.gsi.go.jp/development/ichiran.html
[s13]: https://github.com/indigo-lab/plateau-tokyo23ku-building-mvt-2020
[s14]: https://www.geospatial.jp/ckan/dataset/plateau-tokyo23ku-3dtiles-2020
[s15]: https://www.kensetsu.metro.tokyo.lg.jp/road/kensetsu/yusenseibirosen5
[s16]: https://tokei-gis2.chiyodatoshikei.jp/server/rest/services/Map_services/chikukeikaku/MapServer/6
[s17]: https://www.city.chiyoda.lg.jp/koho/machizukuri/toshi/yotochiiki/saikaihatsu.html
[s18]: https://www.city.chiyoda.lg.jp/koho/machizukuri/kankyo/gaiyoichiran/index.html
[s19]: https://www.toshiseibi.metro.tokyo.lg.jp/basic/singikai/aramashi/seido_3
[s20]: https://www.city.chiyoda.lg.jp/documents/17862/toshimasu-4_2.pdf
[s21]: https://www.city.chiyoda.lg.jp/documents/26577/r2shingikai1-shiryo2-4-1.pdf
[s22]: https://www.city.chiyoda.lg.jp/koho/machizukuri/kekan/ichiranhyo.html
[s23]: https://www.city.chiyoda.lg.jp/koho/kurashi/volunteer/kioku/index.html
[s24]: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L01-2026.html
[s25]: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html
