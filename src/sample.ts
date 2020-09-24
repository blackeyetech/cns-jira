// Imports here
import CNShell, { HttpError } from "cn-shell";

import { netboxApi } from "./netbox-api";

// Netbox config consts here
const CFG_NETBOX_SERVER = "NETBOX_SERVER";
const CFG_NETBOX_API_KEY = "NETBOX_API_KEY";

// HTTP Prop Patterns here

process.on("unhandledRejection", error => {
  // Will print "unhandledRejection err is not defined"
  console.log("unhandledRejection", error);
});

// CNNetbox class here
class CNNetbox extends CNShell {
  // Properties here
  private _netboxServer: string;
  private _netboxApiKey: string;

  // Constructor here
  constructor(name: string) {
    super(name);

    this._netboxServer = this.getRequiredCfg(CFG_NETBOX_SERVER);
    this._netboxApiKey = this.getRequiredCfg(CFG_NETBOX_API_KEY);
  }

  // Abstract method implementations here
  async start(): Promise<boolean> {
    return true;
  }

  async stop(): Promise<void> {
    return;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  // Public methods here
  public async get(
    group: string,
    resource: string,
    params?: { [key: string]: any },
    id?: string,
  ): Promise<{ [key: string]: any }[]> {
    if (netboxApi[group] === undefined) {
      throw this.error(`'${group}' is not a valid group`);
    }
    if (netboxApi[group][resource] === undefined) {
      throw this.error(
        `'${resource}' is not a valid resource in group '${group}'`,
      );
    }

    let url = `${this._netboxServer}${netboxApi[group][resource]}`;

    if (id !== undefined) {
      url = `${url}/${id}`;
    }

    let results: { [key: string]: any }[] = [];

    // Loop until there are no more pages of results
    while (true) {
      let res = await this.httpReq
        .get(url, {
          headers: {
            Authorization: `Token ${this._netboxApiKey}`,
          },
          params,
        })
        .catch(e => {
          let error: HttpError = {
            status: e.response.status,
            message: e.response.data,
          };

          throw error;
        });

      results = results.concat(res.data.results);

      // Check if there are more pages of results
      if (res.data.next !== null) {
        // The next field is a URL but the it is http:// instead of https:// so fix this
        let parts = res.data.next.split("/api/");
        url = `${this._netboxServer}/api/${parts[1]}`;

        // The next field also contains the query paramters so lets clear params
        params = undefined;
      } else {
        // No more data so break out of loop
        break;
      }
    }

    return results;
  }
}

export { CNNetbox };
