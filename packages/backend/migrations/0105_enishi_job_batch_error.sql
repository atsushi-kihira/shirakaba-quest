-- 検索ジョブの束が失敗したときの理由（時間切れ・AIの利用回数の上限など）。失敗が多いときの、管理者へのお知らせに使う
ALTER TABLE enishi_search_job_batches ADD COLUMN last_error TEXT;
