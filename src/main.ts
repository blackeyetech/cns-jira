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
    id: string;
  };
}

// CNJira class here
class CNJira extends CNShell {
  // Properties here
  private _server: string;
  private _resourceUrls: { [key: string]: string };
  private _fieldDict: FieldDict;
  private _projects: ProjectDetails;

  // Constructor here
  constructor(name: string) {
    super(name);

    let server = this.getRequiredCfg(CFG_JIRA_SERVER);
    this._server = server.replace(/(\/+$)/, "");

    // Prepend the server to the resources to make our life easier
    this._resourceUrls = {};
    for (let r in JiraResources) {
      this._resourceUrls[r] = `${this._server}${JiraResources[r]}`;
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
    let url = this._resourceUrls.session;

    let res = await this.httpReq({
      method: "post",
      url,
      data: {
        username: auth.username,
        password: auth.password,
      },
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
      },
    }).catch(e => {
      let error: HttpError = {
        status: e.response.status,
        message: e.response.data,
      };

      throw error;
    });

    return res.data.session.value;
  }

  async logout(sessionId: string): Promise<void> {
    let url = this._resourceUrls.session;

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
    if (this._fieldDict !== undefined && update === false) {
      return this._fieldDict;
    }

    let url = this._resourceUrls.field;

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

    this._fieldDict = { byId: {}, byName: {} };

    if (Array.isArray(res.data)) {
      for (let field of res.data) {
        this._fieldDict.byName[field.name] = field.id;
        this._fieldDict.byId[field.id] = field.name;
      }
    }

    return this._fieldDict;
  }

  public async getProjects(
    sessionId: string,
    update: boolean = false,
  ): Promise<ProjectDetails> {
    // Check to see if the projects are populated AND the user hasn't requested it to be updated
    if (this._projects !== undefined && update === false) {
      return this._projects;
    }

    let url = this._resourceUrls.project;

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

    this._projects = {};

    if (Array.isArray(res.data)) {
      for (let project of res.data) {
        this._projects[project.key] = {
          name: project.name,
          id: project.id,
        };
      }
    }

    return this._projects;
  }

  public async createIssue(
    projectKey: string,
    fields: string[],
    sessionId: string,
  ): Promise<string> {
    await this.getProjects(sessionId);

    let projectId = this._projects[projectKey].id;

    let issue: { [key: string]: any } = {
      fields: {
        project: {
          id: projectId,
        },
      },
    };

    // Convert any field names to field IDs
    await this.getFieldDict(sessionId);

    for (let fname in fields) {
      let fid = this._fieldDict.byName[fname];

      if (fid !== undefined) {
        issue.fields[fid] = fields[fname];
      } else {
        issue.fields[fname] = fields[fname];
      }
    }

    let url = this._resourceUrls.issue;

    let res = await this.httpReq({
      method: "post",
      url,
      data: issue,
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

    return res.data.key;
  }

  public async getIssue(
    sessionId: string,
    idOrKey: string,
  ): Promise<{ [key: string]: string }> {
    let url = `${this._resourceUrls.issue}/${idOrKey}`;

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

    let issue: { [key: string]: any } = {};

    // Convert any field name to field IDs
    await this.getFieldDict(sessionId);

    for (let fid in res.data.fields) {
      let fname = this._fieldDict.byId[fid];

      if (fname !== undefined) {
        issue[fname] = res.data.fields[fid];
      } else {
        issue[fid] = res.data.fields[fid];
      }
    }

    return issue;
  }

  public async assignIssue(
    idOrKey: string,
    assignee: string,
    sessionId: string,
  ): Promise<void> {
    let url = `${this._resourceUrls.issue}/${idOrKey}/assignee`;

    await this.httpReq({
      method: "put",
      url,
      data: {
        name: assignee,
      },
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

  public async addComment(
    idOrKey: string,
    comment: string,
    sessionId: string,
  ): Promise<void> {
    let url = `${this._resourceUrls.issue}/${idOrKey}/comment`;

    await this.httpReq({
      method: "post",
      url,
      data: {
        body: comment,
      },
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

  public async addWatcher(
    idOrKey: string,
    watcher: string,
    sessionId: string,
  ): Promise<void> {
    let url = `${this._resourceUrls.issue}/${idOrKey}/watchers`;

    await this.httpReq({
      method: "post",
      url,
      data: watcher,
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

  public async getTransitions(
    idOrKey: string,
    sessionId: string,
  ): Promise<{ [key: string]: string }> {
    let url = `${this._resourceUrls.issue}/${idOrKey}/transitions`;

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

    let transitions: { [key: string]: string } = {};

    for (let transition of res.data.transitions) {
      transitions[transition.name] = transition.id;
    }

    return transitions;
  }

  public async doTransition(
    idOrKey: string,
    transitionIdOrName: string,
    sessionId: string,
    fields?: string[],
    comment?: string,
  ): Promise<void> {
    // transition may be the Transition ID or name so check
    let availableTransitions = await this.getTransitions(idOrKey, sessionId);
    let transitionId = availableTransitions[transitionIdOrName];

    if (transitionId === undefined) {
      transitionId = transitionIdOrName;
    }

    let dfields: { [key: string]: { [key: string]: string } } = {};

    if (fields !== undefined) {
      // Convert any field names to field IDs
      await this.getFieldDict(sessionId);

      for (let fname in fields) {
        let fid = this._fieldDict.byName[fname];

        if (fid !== undefined) {
          dfields[fid] = { name: fields[fname] };
        } else {
          dfields[fname] = { name: fields[fname] };
        }
      }
    }

    let dcomment = { comment: [{ add: { body: comment } }] };

    let data = {
      update: comment === undefined ? undefined : dcomment,
      fields: fields === undefined || fields.length === 0 ? undefined : dfields,
      transition: { id: transitionId },
    };

    let url = `${this._resourceUrls.issue}/${idOrKey}/transitions`;

    await this.httpReq({
      method: "post",
      url,
      data,
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
}

export { CNJira, AuthDetails, FieldDict, ProjectDetails };
