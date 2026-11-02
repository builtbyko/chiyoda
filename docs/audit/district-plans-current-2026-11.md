# 地区計画の現行資料照合（2026年11月）

2026-11-01に千代田・中央・港・新宿・文京・台東の地区計画を各区の公式一覧・決定図書と照合。東京都GIS由来の通常外枠117面、再開発等促進区外枠59面、千代田区公式GIS由来の内部区分181面を対象とした。2025年の東京都GIS原資料との全件一致を記録した[前回監査](district-plans-audit.md)は、現在の決定内容との一致を保証しない。

## 反映した変更情報

GeoJSONの `i`・`d`・`a` は外枠の元データ値として保持。公式資料の現行最終変更日は `_current_decision`、現行公表面積は `_current_area_ha`、資料リンクは `_current_source_url` に追加した。これにより異なる資料時点を混同しない。

| 区 | 計画 | 外枠元データの最終変更 → 現行最終変更 | 区域の扱い |
|---|---|---|---|
| 千代田 | [神田佐久間町](https://www.city.chiyoda.lg.jp/documents/4355/07sakuma-r70707.pdf) | 2004-06-21 → 2025-07-07 | 外枠据え置き。千代田区公式GIS内部区分と概況照合。 |
| 千代田 | [大手町・丸の内・有楽町](https://www.city.chiyoda.lg.jp/documents/4355/14daimaruyu-r70627.pdf) | 2015-01-09 → 2025-06-27 | 千代田区側の行のみ更新。中央区側の同名別行は別決定。両行の和集合と区公式内部区分はIoU 0.998。 |
| 中央 | [日本橋兜町・茅場町一丁目](https://www.city.chuo.lg.jp/documents/17577/2025082605.pdf) | 2019-07-01 → 2025-05-23 | 全体約10.7ha据え置き。A-2街区追加等は内部区分変更で、外枠には表れない。現行の区資料は2025年5月の決定を明記。正確な23日は区の更新履歴・都市計画概要の検索索引と[区の図書掲載日](https://www.city.chuo.lg.jp/a0043/machizukuri/toshikeikaku/jouhou/chikukeikaku/toshikeikakutosyo.html)で確認したが、更新履歴PDFの元URLは現在404。 |
| 新宿 | [新宿駅東口](https://www.city.shinjuku.lg.jp/kusei/keikan01_002178.html) | 2025-05-02 → 2026-04-28 | [変更概要](https://www.city.shinjuku.lg.jp/content/000437862.pdf)は区域約18.9ha・方針付図1に変更なし。外枠据え置き。 |
| 文京 | [後楽二丁目](https://www.city.bunkyo.lg.jp/documents/4348/20260305-bunkyo-chikukeikaku-koraku2_non-sokatsu.pdf) | 2004-08-13 → 2026-03-05 | 現行区域4.0→6.6ha。旧ポリゴンを灰色の「旧区域」として表示。 |
| 港 | [田町駅東口](https://www.sonicweb-asp.jp/minato/files/pdf/09.pdf) | 2023-03-08 → 2025-12-22 | 現行区域5.7→6.4ha。旧ポリゴンを灰色の「旧区域」として表示。 |
| 港 | [品川駅西口](https://www.sonicweb-asp.jp/minato/files/pdf/39.pdf) | 2022-11-09 → 2025-12-22 | 全体の公表面積14.7haは据え置き。地区整備計画区域13.9→14.7haはこの外枠データに表れない。 |

港区の[現行地区計画一覧](https://www.sonicweb-asp.jp/minato/files/chikukei.html)との照合で、元データ由来の属性誤りも2件修正した。田町駅西口駅前地区の `d` は2024-06-08から決定日2024-04-08へ、赤坂四丁目薬研坂地区の `i` は2020-04-26から2002-04-26へ訂正した。前者の[決定図書](https://www.sonicweb-asp.jp/minato/files/pdf/48.pdf)も確認済み。

## 区境片と区域精度

通常地区計画11面は、他区で決定された計画の0.001～0.157haの区境片。代表点に基づく `w` と元データの照会先 `o` を別に表示し、検索結果にも「○区側の一部（照会先：△区）」と表示する。再開発等促進区「臨海副都心青海地区」の港区側0.016haの小片にも、計画全体117haと[計画図書の所在地](https://www.city.koto.lg.jp/390111/machizukuri/toshi/chiku/kekaku/documents/toshikeikakutosyo_aomi.pdf)を区別して表示する。地図上の区別地物数をそのまま公式計画数として扱わない。

後楽二丁目・田町駅東口の現行計画図はPDFで確認できるが、公開再利用可能な現行区域の機械可読ポリゴンは確認できなかった。地図を推測でトレースせず、旧図形を灰色と「旧区域」ラベルで明示し、公式図書へリンクする。品川駅西口も公表面積の一致だけで外周形状の完全一致を証明したわけではない。全176外枠を最新法定図面と敷地単位で照合したわけではなく、個別敷地の判断には各区の図書を使用する。

## 再生成

`scripts/data/district-plan-official-updates.json` が確認済み差分の台帳。`scripts/build_map_data.py` は基礎データ再生成時にこの台帳を適用する。既存のGeoJSONだけ更新する場合は `python scripts/apply_district_plan_updates.py` を実行する。同スクリプトは計画名・区名・元資料の変更日と面積を照合し、一致しない場合は失敗する。区域座標は変更しない。
