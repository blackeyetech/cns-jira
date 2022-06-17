import CNShell from "cn-shell";

import { JiraResources } from "./jira-resource-url";

// Jira config consts here
const CFG_JIRA_SERVER = "JIRA_SERVER";

const CFG_JIRA_USER = "JIRA_USER";
const CFG_JIRA_PASSWORD = "JIRA_PASSWORD";

const CFG_SESSION_REFRESH_PERIOD = "SESSION_REFRESH_PERIOD";

const DEFAULT_SESSION_REFRESH_PERIOD = "60"; // In mins

// Misc consts here
const SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL =
  "rest/scriptrunner/latest/canned/com.onresolve.scriptrunner.canned.jira.admin.ChangeSharedEntityOwnership";

// process.on("unhandledRejection", error => {
//   // Will print "unhandledRejection err is not defined"
//   console.log("unhandledRejection", error);
// });

// Interfaces here
interface AuthDetails {
  username: string;
  password: string;
}

interface FieldDict {
  byName: { [key: string]: { id: string; type: string; itemType: string } };
  byId: { [key: string]: { name: string; type: string; itemType: string } };
}

interface DashboardsAndFiltersOject {
  name: string;
  values: [number, string][];
}

// CNJira class here
class CNJira extends CNShell {
  // Properties here
  private _server: string;
  private _user: string;
  private _password: string;
  private _jiraSessionId: string | undefined;

  private _refreshPeriod: number;
  private _timeout: NodeJS.Timeout;

  private _resourceUrls: { [key: string]: string };
  private _fieldDict: FieldDict;

  // Constructor here
  constructor(name: string, master?: CNShell) {
    super(name, master);

    let server = this.getRequiredCfg(CFG_JIRA_SERVER);
    this._server = server.replace(/(\/+$)/, "");

    this._user = this.getCfg(CFG_JIRA_USER);
    this._password = this.getCfg(CFG_JIRA_PASSWORD, undefined, false, true);

    let period = this.getCfg(
      CFG_SESSION_REFRESH_PERIOD,
      DEFAULT_SESSION_REFRESH_PERIOD,
    );
    this._refreshPeriod = parseInt(period, 10) * 60 * 1000; // Convert to ms

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

  // Private methods here

  // Public methods here
  public async login(auth?: AuthDetails): Promise<void> {
    let url = this._resourceUrls.session;

    let res = await this.httpReq({
      method: "post",
      url,
      data: {
        username: auth !== undefined ? auth.username : this._user,
        password: auth !== undefined ? auth.password : this._password,
      },
    });

    this._jiraSessionId = res.data.session.value;

    // Start a timer to sutomatically renew the session ID
    this._timeout = setTimeout(() => {
      this.info("Refreshing session ID!");
      this.login();
    }, this._refreshPeriod);
  }

  public async logout(): Promise<void> {
    if (this._jiraSessionId === undefined) {
      return;
    }

    // Stop the timer first!
    clearInterval(this._timeout);

    let url = this._resourceUrls.session;

    await this.httpReq({
      method: "delete",
      url,
      headers: {
        cookie: `JSESSIONID=${this._jiraSessionId}`,
      },
    });

    this._jiraSessionId = undefined;
  }

  public async getFieldDict(update: boolean = false): Promise<FieldDict> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    // Check to see if the field dict is populated AND the user hasn't requested it to be updated
    if (this._fieldDict !== undefined && update === false) {
      return this._fieldDict;
    }

    let url = this._resourceUrls.field;

    let res = await this.httpReq({
      method: "get",
      url,
      headers,
    });

    this._fieldDict = { byId: {}, byName: {} };

    if (Array.isArray(res.data)) {
      for (let field of res.data) {
        this._fieldDict.byName[field.name] = {
          id: field.id,
          type: field.schema !== undefined ? field.schema.type : "Unknown",
          itemType: field.schema !== undefined ? field.schema.items : "Unknown",
        };
        this._fieldDict.byId[field.id] = {
          name: field.name,
          type: field.schema !== undefined ? field.schema.type : "Unknown",
          itemType: field.schema !== undefined ? field.schema.items : "Unknown",
        };
      }
    }

    return this._fieldDict;
  }

  public async getAllowedFieldValues(
    projectKey: string,
    issueType: string,
    fieldName: string,
  ): Promise<string[]> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = this._resourceUrls.createmeta;

    let params = new URLSearchParams();
    params.append("expand", "projects.issuetypes.fields");
    params.append("projectKeys", projectKey);
    params.append("issuetypeNames", issueType);

    let res = await this.httpReq({
      method: "get",
      url,
      params,
      headers,
    });

    // Convert field name to field ID
    let dict = await this.getFieldDict();
    let fieldInfo = dict.byName[fieldName];

    if (fieldInfo === undefined) {
      throw Error(`Unknown field ${fieldName}`);
    }

    let field = res.data.projects[0].issuetypes[0].fields[fieldInfo.id];

    if (field === undefined || field.allowedValues === undefined) {
      return [];
    }

    let allowed: string[] = [];

    for (let info of field.allowedValues) {
      allowed.push(info.value);
    }

    return allowed;
  }

  public async getComponents(
    projectKey: string,
  ): Promise<{ [key: string]: string }> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.components}/${projectKey}/components`;

    let res = await this.httpReq({
      method: "get",
      url,
      headers,
    });

    let components: { [key: string]: string } = {};

    for (let component of res.data) {
      components[component.name] = component.id;
    }

    return components;
  }

  public async getProjects(component?: string): Promise<any[]> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = this._resourceUrls.project;

    let params = new URLSearchParams();
    params.append("expand", "lead");

    let res = await this.httpReq({
      method: "get",
      url,
      headers,
      params,
    });

    // This is not the full interface but all we need to here
    interface Project {
      projectCategory: { name: string };
    }

    let projects = <Project[]>res.data;

    if (component !== undefined) {
      return projects.filter(el => el.projectCategory.name === component);
    }

    return projects;
  }

  // TODO: add getProject

  public async updateProject(
    project: string,
    data: { [key: string]: string },
  ): Promise<void> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.project}/${project}`;

    await this.httpReq({
      method: "put",
      url,
      headers,
      data,
    });
  }

  public async updateProjectLead(project: string, lead: string) {
    await this.updateProject(project, { lead });
  }

  public async createIssue(
    projectKey: string,
    issueType: string,
    component: string,
    fields: { [key: string]: any },
  ): Promise<string> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let components = await this.getComponents(projectKey);

    let issue: { [key: string]: any } = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: issueType },
        components: [{ id: components[component] }],
      },
    };

    // Convert any field names to field IDs
    await this.getFieldDict();

    for (let fname in fields) {
      let fid = this._fieldDict.byName[fname]?.id;

      if (fid !== undefined) {
        issue.fields[fid] = fields[fname];
      } else {
        issue.fields[fname] = fields[fname];
      }
    }

    let url = this._resourceUrls.issue;

    this.debug("createIssue: issue (%j)", issue);

    let res = await this.httpReq({
      method: "post",
      url,
      data: issue,
      headers,
    });

    return res.data.key;
  }

  public async updateIssue(
    key: string,
    fields: { [key: string]: any },
  ): Promise<string> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let issue: { [key: string]: any } = {
      fields: {},
    };

    // Convert any field names to field IDs
    await this.getFieldDict();

    for (let fname in fields) {
      let fid = this._fieldDict.byName[fname]?.id;

      if (fid !== undefined) {
        issue.fields[fid] = fields[fname];
      } else {
        issue.fields[fname] = fields[fname];
      }
    }

    let url = `${this._resourceUrls.issue}/${key}`;

    let res = await this.httpReq({
      method: "put",
      url,
      data: issue,
      headers,
    });

    return res.data.key;
  }

  public async getIssue(idOrKey: string): Promise<any> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.issue}/${idOrKey}`;

    let res = await this.httpReq({
      method: "get",
      url,
      headers,
    });

    let issue: { [key: string]: any } = {};

    // Convert any field IDs to field name
    await this.getFieldDict();

    for (let fid in res.data.fields) {
      let fname = this._fieldDict.byId[fid]?.name;

      if (fname !== undefined) {
        issue[fname] = res.data.fields[fid];
      } else {
        issue[fid] = res.data.fields[fid];
      }
    }

    // Add id to list of fields
    issue["id"] = res.data.id;

    return issue;
  }

  public async issueReporter(key: string, reporter: string): Promise<void> {
    await this.updateIssue(key, { reporter: { name: reporter } });
  }

  public async assignIssue(idOrKey: string, assignee: string): Promise<void> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.issue}/${idOrKey}/assignee`;

    await this.httpReq({
      method: "put",
      url,
      data: {
        name: assignee,
      },
      headers,
    });
  }

  public async updateLabels(
    key: string,
    action: "add" | "remove",
    labels: string[],
  ): Promise<string> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let issue: { update: { labels: any[] } } = {
      update: {
        labels: [],
      },
    };

    issue.update.labels = [];

    // Convert any field names to field IDs
    await this.getFieldDict();
    for (let label of labels) {
      issue.update.labels.push({ [action]: label });
    }

    let url = `${this._resourceUrls.issue}/${key}`;

    let res = await this.httpReq({
      method: "put",
      url,
      data: issue,
      headers,
    });

    return res.data.key;
  }

  public async addComment(idOrKey: string, comment: string): Promise<void> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.issue}/${idOrKey}/comment`;

    await this.httpReq({
      method: "post",
      url,
      data: {
        body: comment,
      },
      headers,
    });
  }

  public async addWatcher(idOrKey: string, watcher: string): Promise<void> {
    let headers: { [key: string]: string } = {
      "Content-Type": "application/json;charset=UTF-8",
    };

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.issue}/${idOrKey}/watchers`;

    await this.httpReq({
      method: "post",
      url,
      data: JSON.stringify(watcher),
      headers,
    });
  }

  public async removeWatcher(idOrKey: string, watcher: string): Promise<void> {
    let headers: { [key: string]: string } = {
      "Content-Type": "application/json;charset=UTF-8",
    };

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.issue}/${idOrKey}/watchers`;

    let params = new URLSearchParams();
    params.append("username", watcher);

    await this.httpReq({
      method: "delete",
      url,
      data: JSON.stringify(watcher),
      headers,
      params,
    });
  }

  public async getTransitions(
    idOrKey: string,
  ): Promise<{ [key: string]: string }> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.issue}/${idOrKey}/transitions`;

    let res = await this.httpReq({
      method: "get",
      url,
      headers,
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
    fields?: string[],
    comment?: string,
  ): Promise<void> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    // transition may be the Transition ID or name so check
    let availableTransitions = await this.getTransitions(idOrKey);
    let transitionId = availableTransitions[transitionIdOrName];

    if (transitionId === undefined) {
      transitionId = transitionIdOrName;
    }

    let dfields: { [key: string]: { [key: string]: string } } = {};

    if (fields !== undefined) {
      // Convert any field names to field IDs
      await this.getFieldDict();

      for (let fname in fields) {
        let fid = this._fieldDict.byName[fname]?.id;

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
      headers,
    });
  }

  public async runJql(jql: string): Promise<any[]> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._resourceUrls.search}?jql=${encodeURI(jql)}`;

    let res = await this.httpReq({
      method: "get",
      url,
      headers,
    });

    if (res === undefined) {
      return [];
    }

    return res.data;
  }

  public async getUserDashboardIds(userId: string): Promise<number[]> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._server}/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}/params`;

    let res = await this.httpReq({
      method: "post",
      url,
      data: {
        FIELD_FROM_USER_ID: userId,
      },
      headers,
    });

    let dashboardIds: number[] = [];

    let data = <DashboardsAndFiltersOject[]>res.data;

    for (let obj of data) {
      if (obj.name === "FIELD_DASHBOARD_IDS") {
        for (let value of obj.values) {
          dashboardIds.push(value[0]);
        }
      }
    }

    return dashboardIds;
  }

  public async getUserFilterIds(userId: string): Promise<number[]> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._server}/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}/params`;

    let res = await this.httpReq({
      method: "post",
      url,
      data: {
        FIELD_FROM_USER_ID: userId,
      },
      headers,
    });

    let filterIds: number[] = [];

    let data = <DashboardsAndFiltersOject[]>res.data;

    for (let obj of data) {
      if (obj.name === "FIELD_FILTER_IDS") {
        for (let value of obj.values) {
          filterIds.push(value[0]);
        }
      }
    }

    return filterIds;
  }

  public async migrateDashboards(
    fromUserId: string,
    toUserId: string,
    dashboardIds: number[],
  ): Promise<void> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._server}/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}/preview`;

    let res = await this.httpReq({
      method: "post",
      url,
      data: {
        FIELD_FROM_USER_ID: fromUserId,
        FIELD_TO_USER_ID: toUserId,
        FIELD_DASHBOARD_IDS: dashboardIds,
        FIELD_FILTER_IDS: [],
      },
      headers,
    });

    this.info("%s", res.data);
  }

  public async migrateFilters(
    fromUserId: string,
    toUserId: string,
    filterIds: number[],
  ): Promise<void> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = `${this._server}/${SCRIPTRUNNER_DASHBOARDS_N_FILTERS_URL}/preview`;

    let res = await this.httpReq({
      method: "post",
      url,
      data: {
        FIELD_FROM_USER_ID: fromUserId,
        FIELD_TO_USER_ID: toUserId,
        FIELD_DASHBOARD_IDS: [],
        FIELD_FILTER_IDS: filterIds,
      },
      headers,
    });

    this.info("%s", res.data);
  }

  public async getUser(
    user: string,
    byKey: boolean,
    includeGroups: boolean = false,
  ): Promise<Object> {
    let headers: { [key: string]: string } = {};

    if (this._jiraSessionId !== undefined) {
      headers.cookie = `JSESSIONID=${this._jiraSessionId}`;
    } else {
      let token = Buffer.from(`${this._user}:${this._password}`).toString(
        "base64",
      );
      headers.Authorization = `Basic ${token}`;
    }

    let url = this._resourceUrls.user;

    let params = new URLSearchParams();
    if (byKey) {
      params.append("key", user);
    } else {
      params.append("username", user);
    }

    if (includeGroups) {
      params.append("expand", "groups");
    }

    let res = await this.httpReq({
      method: "get",
      url,
      params,
      headers,
    });

    return res.data;
  }
}

export { CNJira, AuthDetails, FieldDict };
