import { withSchedulerMeta } from "../_scheduler-meta";

export const onRequestGet = ({ next }: { next: () => Promise<Response> }): Promise<Response> => withSchedulerMeta(next);
