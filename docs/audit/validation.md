# 精査・修正の検証記録

2026-09-14。基準main `4b0cecfbf47fcfec6f10f046189280ff113f9fa6` と修正後の作業ツリーを区別する。新規HTTPデータ取得は行っていない。

| 検査 | 結果 | 範囲・注意 |
|---|---|---|
| `node scripts/audit_atlas_data.mjs` | 成功 | active25ファイル7,434地物、検索2,078件の参照不整合0、メタ件数不整合0、座標構造エラー0。日付をIDや人口密度と取り違えない |
| `python scripts/audit_atlas_geometry.py` | 成功 | Shapely2.1.2、無効・空形状0、6区実区域外ポイント0。境界の丸め・簡略化による微小超過は報告し、自動補正しない |
| `npm run lint` | 成功 | 修正後の最終実行、exit0 |
| `npm test` | ローカルWindowsではexit1 | 5段階ビルド・1ルートprerenderは成功。その後の終了処理で`UV_HANDLE_CLOSING` assertion。基準版でも生じる既知のWindows実行環境の問題。後続Nodeテストはこのコマンドの中では未実行 |
| Nodeテストを別途実行 | 38/38成功 | UI整理後に再ビルドした生成物でSSRを検査。lazy-load・検索・地図式・追加促進区スタイル・同点全プレートの選択集合・現在地・PC描画設定に加え、全27トグル・メニュー順・背景を1種類だけ保持する切替・OSM出典表示を検査。ブラウザの実操作QAとは別 |
| 都市更新前処理の追加テスト | 7/7成功 | 工事種別分離、実取得記録、記録なしキャッシュ、URL・日付検証、整理日と取得日の分離 |
| 既存都市更新前処理テスト | 6/6成功 | 公式列・収録判定・名寄せ・誤位置回避等 |
| 正式プレート名称のテスト | 1/1成功 | 限定補正、n／件名／schema一致、元frame・他名称・dataset・座標・IDを維持 |
| 既存道路安全テスト | 6/6成功 | 推測した属性・区間を採用しない既存の安全条件 |
| cached都市更新再生成の差分 | 成功 | HTTP禁止で再生成。77件のID・順序・geometry・category・completion・面積は完全不変。uses23、constructionType1、compiledDate77追加、未裏付けretrievedDate48除去のみ |
| `git diff --check` | 成功 | 不要な空白エラーなし |

Nodeは既存のbundled Node24を使用し、GitHub Pagesと同じ`GITHUB_ACTIONS=true`でビルド。Python前処理はローカルキャッシュの`urban-change/python-venv`、幾何・道路は`road-upgrade-venv`、名称テストは既存system PythonのGeoPandas／Shapelyを使用した。ライブラリの新規追加・ダウンロードはない。

再現コマンド（依存関係導入済みの対応環境で実行）：

```bash
node scripts/audit_atlas_data.mjs
python scripts/audit_atlas_geometry.py
npm run lint
npm test
# Windowsの既知の終了エラー後に生成物ができている場合の別途検査
node --test tests/rendered-html.test.mjs tests/lazy-geo-json.test.mjs tests/geolocation.test.mjs
python scripts/tests/test_build_urban_change_projects.py
python tests/test_urban_change_builder.py
python tests/test_official_layer_names.py
python tests/test_road_upgrade.py
```

## 背景・レイヤーUI整理後の確認

同日、最新航空写真を初期背景に戻し、背景地図セレクトを地図右上へ移動した。OSM・淡色地図・既存7区分の歴史航空写真も同じ操作で選択する。全27行を既存のON/OFFトグルへ統一し、面表示6種の排他選択と選択中の再クリックOFFは維持。左メニューの先頭は都市計画、再開発・まちづくり、地域・歴史とした。データ追加・地図操作設定・lazy-load設計の変更はない。

`npm run lint`は再実行でexit0。`npm test`は5段階ビルドと1ルートprerender後、上表と同じWindows終了エラーでexit1。その生成物に対する別実行のNodeテストは38件成功。

ローカル開発画面の実ブラウザではPC幅1440pxとスマートフォン幅390pxで配置・メニューを確認。航空写真→OSM→淡色地図の切替、OSM出典リンク、用途地域→住民密度の排他選択、住民密度の再クリックOFFを確認した。OSMは通常の画面表示のみで、タイルの一括取得・保存・先読みは行っていない。現在地の許可や実位置取得は検査していない。

GitHub上のLinux CI／公開反映はローカル検査とは別に結果確認が必要。現在の公式サイト最新性、各計画図書の法的解釈、操作負荷の定量計測は今回確認していない。

公開作業の経過：前回の試行ではGit索引更新の自動権限審査が2回タイムアウトし、commit・push・新CI実行前に停止した。危険性を判定した拒否ではなく、審査サービスの期限超過だった。その後の利用者の公開依頼で再開し、Git書込・ネットワーク権限の承認とリモートmainの基準コミット一致を確認した。公開環境でのビルド・テスト・配信の最終結果は、対象コミットの[GitHub Pagesワークフロー](https://github.com/builtbyko/chiyoda/actions/workflows/pages.yml)で確認する。上記のローカルWindows結果とLinux CI結果は混同しない。

## 坂レイヤー追加時の確認

2026-09-14、公開済みmain `4c92bd6` を基準に追加。千代田区の坂一覧と千代田区観光協会の案内60ページだけを実取得し、案内地点54件を生成。公式GISや区間線として扱わず、位置矛盾2件は除外。独立レビューで名称・同名坂の住所対応・短い由来・公開q座標との一致を確認した。

データ検査は26ファイル7,488地物、検索2,132件の不整合0。`npm run lint`成功、Windowsの`npm test`は従来と同じビルド完了後の終了assertionでexit1。その生成物への別実行Nodeテスト42件と、`python tests/test_slopes_builder.py`の安全性テスト9件は成功。公開用の静的生成物をローカル配信し、PC画面で航空写真上の坂ポイント・名称ラベル、検索によるON・ズーム・詳細表示、ポイントクリック、地形・陰影との併用を確認。モバイル画面でも検索・詳細の表示を確認した。開発サーバーのworker描画と、Pages用worker配置済みの公開ビルドは区別して検査している。
