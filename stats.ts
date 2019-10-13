const toUptime = (reset_time: any) => {
    let now_ms: any = new Date();
    const now_sec = Math.floor(now_ms / 1000);
    const uptime = (now_sec - reset_time);
    const total_minutes = Math.floor(uptime / 60);
    const total_hours = Math.floor(total_minutes / 60);
    const days = Math.floor(total_hours / 24);
    const hours = total_hours % 24;
    const minutes = total_minutes % 60;

    const hours_str = hours.toString().padStart(2);
    const mins_str = minutes.toString().padStart(2);

    if (days === 0) {
        return `${hours_str}h ${mins_str}m`
    } else {
        return `${days}d ${hours_str}h ${mins_str}m`
    }
}


export class PeerStats {
    pubkey: string;
    pushes_failed: number;
    requests_failed: number;
    bc_test_failed: number;
    store_test_failed: number;

    constructor(pubkey: string, pushes_failed: number,
                req_failed: number, bc_test_failed: number,
                store_test_failed: number) {
        this.pubkey = pubkey;
        this.pushes_failed = pushes_failed;
        this.requests_failed = req_failed;
        this.bc_test_failed = bc_test_failed;
        this.store_test_failed = store_test_failed;
    }
}

// For a given node how many test we failed based
// on reports from other nodes
export class NodePerformance {
    req_failed: number;
    bc_test_failed: number;
    store_test_failed: number;

    constructor(req_failed: number, bc_test_failed: number, store_test_failed: number) {
        this.req_failed = req_failed;
        this.bc_test_failed = bc_test_failed;
        this.store_test_failed = store_test_failed
    }
}

export const printLifetimeStats = (results: NodeStats[],
                                   status: {[key:string]:string},
                                   test_reports: Map<string, NodePerformance>) => {


    const show_ut_proof = false;
    const show_connections = false;
    const show_height = false;

    /// TODO: print recent request count (and prev. period)
    /// TODO: print target height (?)

    const margin = "  ";
    let header = "";
    header += "PubKey".padStart(16) + margin;
    header += "IP".padStart(16) + margin;
    header += "Port".padStart(5) + margin;
    header += "Uptime".padStart(12) + margin;

    if (show_ut_proof) {
        header += "UT Proof".padStart(12) + margin;
    }

    header += "Store".padStart(10) + margin;
    header += "Store recent".padStart(12) + margin;

    header += "Total stored".padStart(12) + margin;

    header += "Retrieve".padStart(10) + margin;

    if (show_height) {
        header += "Height".padStart(8) + margin;
    }

    header += "Req failed".padStart(12) + margin;

    header += "BC failed".padStart(10) + margin;
    header += "Strg failed".padStart(12) + margin;

    header += "Status".padStart(10) + margin;
    header += "Version".padStart(8) + margin;

    if (show_connections) {
        header += "Connections (in|out_http|out_https)".padStart(35);
    }

    console.log(header);
    console.log("-".repeat(header.length));

    let swarm_ids: Map<string, NodeStats[]> = new Map();

    results.forEach((res: NodeStats) => {

        if (!swarm_ids.has(res.swarm_id)) {
            swarm_ids.set(res.swarm_id, []);
        }
        let val = swarm_ids.get(res.swarm_id);
        val.push(res);
        swarm_ids.set(res.swarm_id, val);
    });

    for (let [swarm_id, stats] of swarm_ids) {

        let swarm_id_str = ` SwarmID: ${swarm_id} `;
        let w = (header.length - swarm_id_str.length) / 2;
        let rem = (header.length - swarm_id_str.length) % 2;
        console.log("=".repeat(w + rem) + swarm_id_str + "=".repeat(w));

        stats.forEach((res: NodeStats) => {

            let line = "";
            line += res.pubkey.substr(0, 16).padStart(16) + margin;
            line += res.ip.padStart(16) + margin;
            line += res.port.toString().padStart(5) + margin;

            const valid = (res.reset_time !== 0);
            const uptime = valid ? toUptime(res.reset_time) : "N/A";
            const ut_proof = valid ? toUptime(res.last_uptime_proof) : "N/A";
            const store_req = valid ? res.total_store_requests.toLocaleString() : "N/A";
            const retrieve_req = valid ? res.client_retrieve_requests.toLocaleString() : "N/A";

            const v105 = (valid && res.version != "1.0.4" && res.version != "1.0.3" && res.version != "");

            const height = v105 ? res.height.toLocaleString() : "N/A";
            const https_in = v105 ? res.https_in.toLocaleString() : "N/A";
            const http_out = v105 ? res.http_out.toLocaleString() : "N/A";
            const https_out = v105 ? res.https_out.toLocaleString() : "N/A";
            const store_recent = v105 ? res.recent_store_requests.toLocaleString() : "N/A";

            const total_stored = v105 ? res.total_stored.toLocaleString() : "N/A";

            line += uptime.padStart(12) + margin;

            if (show_ut_proof) {
                line += ut_proof.padStart(12) + margin;
            }

            line += store_req.padStart(10) + margin;

            line += store_recent.padStart(12) + margin;

            line += total_stored.padStart(12) + margin;

            line += retrieve_req.padStart(10) + margin;

            if (show_height) {
                line += height.padStart(8) + margin;
            }

            /// --- Test results ---

            const num_to_string = (a: number) => {
                if (a === 0) return "";
                return a.toLocaleString();
            };

            const req_failed = test_reports.has(res.pubkey) ? num_to_string(test_reports.get(res.pubkey).req_failed) : "N/A";
            const bc_failed = test_reports.has(res.pubkey) ? num_to_string(test_reports.get(res.pubkey).bc_test_failed) : "N/A";
            const storage_failed = test_reports.has(res.pubkey) ? num_to_string(test_reports.get(res.pubkey).store_test_failed) : "N/A";
            
            line += req_failed.padStart(12) + margin;
            line += bc_failed.padStart(10) + margin;
            line += storage_failed.padStart(12) + margin;

            /// ---- end ----

            line += status[res.pubkey].padStart(10) + margin;
            line += res.version.padStart(8);

            if (show_connections) {
                line += https_in.padStart(17) + http_out.padStart(9) + https_out.padStart(10);
            }

            console.log(line)
        })

    }

    let size_distr: Map<number, number> = new Map();

    for (let [swarm_id, stats] of swarm_ids) {

        if (!size_distr.has(stats.length)) {
            size_distr.set(stats.length, 0);
        }

        let val = size_distr.get(stats.length);
        size_distr.set(stats.length, val + 1);

    }

    console.log("--- Swarm sizes ---");

    for (let [size, count] of size_distr) {
        console.log(`[${size}]: ${count}`);
    }

}

export class NodeStats {
    pubkey: string;
    ip: string;
    port: string;
    total_store_requests: number;
    recent_store_requests: number;
    total_stored: number;
    client_retrieve_requests: number;
    reset_time: number;
    last_uptime_proof: number;
    status: string; //todo
    swarm_id: string;
    peer_stats: Map<string, PeerStats>;
    version: string;
    height: number;

    https_in: number;
    https_out: number;
    http_out: number;

    constructor(pubkey: string, ip: string, port: string, store: number, recent_store: number, total_stored: number,
                retrieve: number, reset_time: number, last_uptime_proof: number, swarm_id: string, ver: string,
                height: number, https_in: number, https_out: number, http_out: number) {
        this.pubkey = pubkey;
        this.ip = ip;
        this.port = port;
        this.total_store_requests = store;
        this.recent_store_requests = recent_store;
        this.total_stored = total_stored;
        this.client_retrieve_requests = retrieve;
        this.reset_time = reset_time;
        this.last_uptime_proof = last_uptime_proof;
        this.swarm_id = swarm_id;
        this.peer_stats = new Map();
        this.version = (ver) ? ver : "";
        this.height = height;
        this.https_in = https_in;
        this.https_out = https_out;
        this.http_out = http_out;
    }

    add_peer_stats(stats: PeerStats) {
        this.peer_stats.set(stats.pubkey, stats);
    }
}
