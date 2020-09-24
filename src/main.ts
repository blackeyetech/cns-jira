import CNShell, { HttpError } from "cn-shell";

import { JiraResources } from "./jira-resource-url";

// Jira config consts here
const CFG_JIRA_SERVER = "server";

process.on("unhandledRejection", error => {
  // Will print "unhandledRejection err is not defined"
  console.log("unhandledRejection", error);
});

// Interfaces here
interface AuthDetails {
  username: string;
  password: string;
}

interface FieldDict {
  byName: { [key: string]: string };
  byId: { [key: string]: string };
}

interface ProjectDetails {
  [key: string]: {
    name: string;
    id: number;
  };
}

// CNJira class here
class CNJira extends CNShell {
  // Properties here
  private _jiraServer: string;
  private _jiraResourceUrls: { [key: string]: string };
  private _jiraFieldDict: FieldDict;

  // Constructor here
  constructor(name: string) {
    super(name);

    let server = this.getRequiredCfg(CFG_JIRA_SERVER);
    this._jiraServer = server.replace(/(\/+$)/, "");

    // Prepend the server to the resources to make our life easier
    for (let r in JiraResources) {
      this._jiraResourceUrls[r] = `${this._jiraServer}${JiraResources[r]}`;
    }
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
  public async login(auth: AuthDetails): Promise<string> {
    //{ JSESSIONID: sessionIdOrAuth };
    let url = this._jiraResourceUrls.session;

    let res = await this.httpReq({
      method: "post",
      url,
      auth: {
        username: auth.username,
        password: auth.password,
      },
    }).catch(e => {
      let error: HttpError = {
        status: e.response.status,
        message: e.response.data,
      };

      throw error;
    });

    return res.data.session;
  }

  async logout(sessionId: string): Promise<void> {
    let url = this._jiraResourceUrls.session;

    await this.httpReq({
      method: "delete",
      url,
      headers: {
        cookie: { JSESSIONID: sessionId },
      },
    }).catch(e => {
      let error: HttpError = {
        status: e.response.status,
        message: e.response.data,
      };

      throw error;
    });
  }

  public async getFieldDict(
    sessionId: string,
    update: boolean = false,
  ): Promise<FieldDict> {
    // Check to see if the field dict is populated AND the user hasn't requested it to be updated
    if (this._jiraFieldDict !== undefined && update === false) {
      return this._jiraFieldDict;
    }

    let url = this._jiraResourceUrls.field;

    let res = await this.httpReq({
      method: "get",
      url,
      headers: {
        cookie: { JSESSIONID: sessionId },
      },
    }).catch(e => {
      let error: HttpError = {
        status: e.response.status,
        message: e.response.data,
      };

      throw error;
    });

    let fieldDict: FieldDict = { byId: {}, byName: {} };

    if (Array.isArray(res.data)) {
      for (let field of res.data) {
        fieldDict.byName[field.name] = field.id;
        fieldDict.byId[field.id] = field.name;
      }
    }

    return fieldDict;
  }

  public async getProjects(sessionId: string): Promise<ProjectDetails> {
    let url = this._jiraResourceUrls.project;

    let res = await this.httpReq({
      method: "get",
      url,
      headers: {
        cookie: { JSESSIONID: sessionId },
      },
    }).catch(e => {
      let error: HttpError = {
        status: e.response.status,
        message: e.response.data,
      };

      throw error;
    });

    let projects: ProjectDetails = {};

    if (Array.isArray(res.data)) {
      for (let project of res.data) {
        projects[project.key] = {
          name: project.name,
          id: project.id,
        };
      }
    }

    return projects;
  }

  public async getIssue(sessionId: string, idOrKey: string) {
    let fieldDict = await this.getFieldDict(sessionId);

    let url = `${this._jiraResourceUrls.issue}/${idOrKey}`;
    let res = await this.httpReq({
      method: "get",
      url,
      headers: {
        cookie: { JSESSIONID: sessionId },
      },
    }).catch(e => {
      let error: HttpError = {
        status: e.response.status,
        message: e.response.data,
      };

      throw error;
    });

    let issue: { [key: string]: string } = {};

    for (let fid in res.data.fields) {
      let fname = fieldDict.byId[fid];
      issue[fname] = res.data.fields[fid];
    }

    return issue;
  }
}

export { CNJira, AuthDetails, FieldDict, ProjectDetails };

//   async createIssue(projectIdOrKey, fields, sessionIdOrAuth) {
//     this.checkSessionIdOrAuth(sessionIdOrAuth);

//     if (typeof projectIdOrKey !== string || projectIdOrKey.length === 0) {
//       throw this.JiraError(400, "Must provide a project ID or Key");
//     }

//     // project may be the Project ID or key so check
//     let projectKeys = await this.getProjects(sessionIdOrAuth),
//       projectId = projectKeys[projectIdOrKey].id;

//     if (projectId === undefined) {
//       projectId = projectIdOrKey;
//     }

//     // Convert any field name to field IDs
//     let fieldDict = await this.getFieldDict(sessionIdOrAuth);
//     for (let f in fields) {
//       let fid = fieldDict.byName[f];
//       if (fid !== undefined) {
//         fields[fid] = fields[f];
//         delete fields[f];
//       }
//     }

//     let url = jiraResourceUrls.issue,
//       options = this.sessionIdOrAuthOptions(sessionIdOrAuth, true);

//     let data = {};
//     data.fields = fields;
//     data.fields.project = { id: projectId };

//     let res = await needle("post", url, data, options);

//     if (res.statusCode === 201) {
//       this.jiraApiLog.info(
//         `User (${username}) is created issue ${res.body.key}`);
//       return res.body.key;
//     }

//     throw this.JiraError(res.statusCode, JSON.stringify(res.body));
//   }

//   async assignIssue(idOrKey, assignee, sessionIdOrAuth) {
//     this.checkSessionIdOrAuth(sessionIdOrAuth);

//     if (typeof idOrKey !== "string" || idOrKey.length === 0) {
//       throw this.JiraError(400, "Must provide an issue ID or Key");
//     }

//     if (typeof assignee !== string || assignee.length === 0){
//       throw this.JiraError(400, "Must provide an assignee");
//     }

//     let url = `${jiraResourceUrls.issue}/${idOrKey}/assignee`,
//       options = this.sessionIdOrAuthOptions(sessionIdOrAuth, true);

//     let res = await needle("put", url, { name: assignee } , options);

//     if (res.statusCode === 204 || res.statusCode === 205) {
//       return;
//     }

//     throw this.JiraError(res.statusCode, JSON.stringify(res.body));
//   }

//   async addComment(idOrKey, comment, sessionIdOrAuth) {
//     this.checkSessionIdOrAuth(sessionIdOrAuth);

//     if (typeof idOrKey !== "string" || idOrKey.length === 0) {
//       throw this.JiraError(400, "Must provide an issue ID or Key");
//     }

//     if (typeof comment !== string || comment.length === 0){
//       throw this.JiraError(400, "Must provide an comment");
//     }

//     let url = `${jiraResourceUrls.issue}/${idOrKey}/comment`,
//       options = this.sessionIdOrAuthOptions(sessionIdOrAuth, true);

//     let res = await needle("post", url, { body: comment } , options);

//     if (res.statusCode === 201) {
//       return;
//     }

//     throw this.JiraError(res.statusCode, JSON.stringify(res.body));
//   }

//   async addWatcher(idOrKey, watcher, sessionIdOrAuth) {
//     this.checkSessionIdOrAuth(sessionIdOrAuth);

//     if (typeof idOrKey !== "string" || idOrKey.length === 0) {
//       throw this.JiraError(400, "Must provide an issue ID or Key");
//     }

//     if (typeof watcher !== string || watcher.length === 0){
//       throw this.JiraError(400, "Must provide an watcher");
//     }

//     let url = `${jiraResourceUrls.issue}/${idOrKey}/watchers`,
//       options = this.sessionIdOrAuthOptions(sessionIdOrAuth, true);

//     let res = await needle("post", url, `\"${watcher}\"`, options);

//     if (res.statusCode === 204 || res.statusCode === 205) {
//       return;
//     }

//     throw this.JiraError(res.statusCode, JSON.stringify(res.body));
//   }

//   async getTransitions(idOrKey, sessionIdOrAuth) {
//     this.checkSessionIdOrAuth(sessionIdOrAuth);

//     if (typeof idOrKey !== "string" || idOrKey.length === 0) {
//       throw this.JiraError(400, "Must provide an issue ID or Key");
//     }

//     let url = `${jiraResourceUrls.issue}/${idOrKey}/transitions`,
//       query = {
//         expand: "transitions",
//         fields: "transitions"
//       },
//       options = this.sessionIdOrAuthOptions(sessionIdOrAuth);

//     let res = await needle("get", url, query, options);

//     let transitions = {};

//     if (res.statusCode === 200 && Array.isArray(res.body.transitions)) {
//       for (let transition of res.body.transitions) {
//         transitions[transition.name] = transition.id;
//       }

//       return transitions;
//     }

//     throw this.JiraError(res.statusCode, JSON.stringify(res.body));
//   }

//   async doTransition(idOrKey, transitionIdOrName, fields, sessionIdOrAuth) {
//     this.checkSessionIdOrAuth(sessionIdOrAuth);

//     if (typeof idOrKey !== "string" || idOrKey.length === 0) {
//       throw this.JiraError(400, "Must provide an issue ID or Key");
//     }

//     if (typeof transitionIdOrName !== string ||
//       transitionIdOrName.length === 0) {

//       throw this.JiraError(400, "Must provide a transition ID or Name");
//     }

//     // transition  may be the Transition ID or name so check
//     let avialable = await this.getTransitions(idOrKey, sessionIdOrAuth),
//       transitionId = avialable[transitionIdOrName];

//     if (transitionId === undefined) {
//       transitionId = transitionIdOrName;
//     }

//     // Convert any field names to field IDs
//     let fieldDict = await this.getFieldDict(sessionIdOrAuth);
//     for (let f in fields) {
//       let fid = fieldDict[f];
//       if (fid !== undefined) {
//         fields[fid] = fields[f];
//         delete fields[f];
//       }
//     }

//     let url = `${jiraResourceUrls.issue}/${idOrKey}/transitions`,
//       options = this.sessionIdOrAuthOptions(sessionIdOrAuth, true);

//     let data = {};
//     data.fields = {};
//     for (let field in fields) {
//       data.fields[field] = { name: fields[field] };
//     }

//     data.transition = { id: transitionId };

//     if (typeof sessionIdOrAuth === "string") {
//       options.cookies = { JSESSIONID: sessionIdOrAuth };
//     } else {
//       options.username = sessionIdOrAuth.username;
//       options.password = sessionIdOrAuth.password;
//     }

//     let res = await needle("post", url, data , options);

//     if (res.statusCode === 204) {
//       return;
//     }

//     throw this.JiraError(res.statusCode, JSON.stringify(res.body));
//   }

//   JiraError(status, msg) {
//     let e = new JiraBapError(status, msg);

//     this.jiraApiLog.error(`${status}: ${e}`);

//     return e;
//   }
// }

// // Use the same version as besh
// JiraBap.version = besh.version;

// module.exports = JiraBap;
