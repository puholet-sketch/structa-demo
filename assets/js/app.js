const APP_KEY = "structa.nordix.demo.v1";
const SEED_VERSION = "nordix-demo-v1";
const APP_NAME = "Structa";
const APP_TAGLINE = "Кадровый реестр с оргструктурой";

const state = {
  data: null,
  selectedDeptId: null,
  selectedEmployeeId: null,
  rememberedPath: "",
  loadedPath: "",
  dragDeptId: null,
  collapsed: new Set(),
  printSelected: new Set(),
  maternityFilterOnly: false,
  employmentFilter: "",
  fallbackCounter: 10000,
  dirty: false,
  formDirty: false
};

const el = (id) => document.getElementById(id);

function status(msg) { el("status").textContent = msg; }

function toast(input, opts = {}) {
  const conf = typeof input === "string" ? { message: input, ...opts } : { ...opts, ...input };
  const { title, message, type = "info", duration = 3800 } = conf;
  const text = message || (typeof input === "string" ? input : "");

  document.querySelectorAll(".toast").forEach((node) => node.remove());

  const box = document.createElement("div");
  box.className = `toast toast--${type}`;
  box.setAttribute("role", "alert");

  const body = document.createElement("div");
  body.className = "toast-body";

  if (title) {
    const heading = document.createElement("strong");
    heading.className = "toast-title";
    heading.textContent = title;
    body.appendChild(heading);
  }

  const line = document.createElement("div");
  line.className = "toast-message";
  line.textContent = text;
  body.appendChild(line);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Закрыть");
  close.textContent = "×";
  close.onclick = () => box.remove();

  box.append(body, close);
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add("toast--visible"));

  setTimeout(() => {
    box.classList.remove("toast--visible");
    setTimeout(() => box.remove(), 280);
  }, duration);
}

function requireAuth() {
  return true;
}

function uid(prefix) {
  if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  state.fallbackCounter += 1;
  return `${prefix}_${Date.now()}_${state.fallbackCounter}`;
}

function findDepartmentById(id, departments = state.data.companies) {
  const stack = [...departments];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    if (n.children?.length) stack.push(...n.children);
  }
  return null;
}

function findDepartmentParent(id, departments = state.data.companies, parent = null) {
  for (const d of departments) {
    if (d.id === id) return parent;
    const found = findDepartmentParent(id, d.children || [], d);
    if (found) return found;
  }
  return null;
}

function removeDepartmentById(id, departments = state.data.companies) {
  for (let i = 0; i < departments.length; i++) {
    if (departments[i].id === id) return departments.splice(i, 1)[0];
    const nested = removeDepartmentById(id, departments[i].children || []);
    if (nested) return nested;
  }
  return null;
}

function walkDepartments(nodes, fn, path = []) {
  nodes.forEach((n) => {
    const p = [...path, n.name];
    fn(n, p);
    if (n.children?.length) walkDepartments(n.children, fn, p);
  });
}

function flattenDepartments() {
  const result = [];
  walkDepartments(state.data.companies, (n, p) => result.push({ id: n.id, name: n.name, path: p.join(" / ") }));
  return result;
}

function getCurrentDept() {
  return state.selectedDeptId ? findDepartmentById(state.selectedDeptId) : null;
}

function findEmployeeDepartment(empId) {
  let result = null;
  walkDepartments(state.data.companies, (d) => {
    if (d.employees.some((e) => e.id === empId)) result = d;
  });
  return result;
}

function searchEmployeesGlobal(q) {
  const matches = [];
  walkDepartments(state.data.companies, (d) => {
    d.employees.forEach((e) => {
      if (matchesSearch(e, q)) matches.push({ emp: e, dept: d });
    });
  });
  return matches;
}

function expandDeptAncestors(deptId) {
  let parent = findDepartmentParent(deptId);
  while (parent) {
    state.collapsed.delete(parent.id);
    parent = findDepartmentParent(parent.id);
  }
}

function focusDeptInTree() {
  requestAnimationFrame(() => {
    document.querySelector("#tree .tree-row.active")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function selectDepartment(deptId, options = {}) {
  const dept = findDepartmentById(deptId);
  if (!dept) return;
  state.selectedDeptId = deptId;
  expandDeptAncestors(deptId);
  if (options.selectHead !== false) {
    state.selectedEmployeeId = dept.employees?.[0]?.id || null;
  }
}

function applyEmployeeSearch() {
  const q = el("employeeSearch").value.trim();
  if (!q) return false;

  const matches = searchEmployeesGlobal(q);
  if (!matches.length) return false;

  const { emp, dept } = matches[0];
  state.selectedDeptId = dept.id;
  expandDeptAncestors(dept.id);
  state.selectedEmployeeId = emp.id;
  return true;
}

function onEmployeeSearchInput() {
  applyEmployeeSearch();
  renderTree();
  renderEmployees();
  fillEmployeeForm();
  const dep = getCurrentDept();
  status(dep ? dep.name : "Выберите отдел");
  focusDeptInTree();
}

function getEmployeeById(id) {
  const dep = getCurrentDept();
  return dep?.employees.find((e) => e.id === id) || null;
}

function collectStats() {
  let depCount = 0, empCount = 0;
  const levels = {};
  walkDepartments(state.data.companies, (n) => {
    depCount += 1;
    empCount += n.employees.length;
    n.employees.forEach((e) => { levels[e.level] = (levels[e.level] || 0) + 1; });
  });
  return { depCount, empCount, levels };
}

function updateStatsUI() {
  const statsEl = el("stats");
  if (!statsEl) return;
  const s = collectStats();
  const levelInfo = Object.entries(s.levels).map(([k, v]) => `${k}: ${v}`).join(" • ");
  statsEl.innerHTML = "";
  [`Отделов: ${s.depCount}`, `Сотрудников: ${s.empCount}`, levelInfo || ""].filter(Boolean).forEach((text) => {
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = text;
    statsEl.appendChild(tag);
  });
}

function allDeptIds() {
  const ids = [];
  walkDepartments(state.data.companies, (n) => ids.push(n.id));
  return ids;
}

function countEmployeesRecursive(node) {
  if (isTreeFilterActive()) return countFilteredEmployeesRecursive(node);
  let total = (node.employees || []).length;
  (node.children || []).forEach((ch) => {
    total += countEmployeesRecursive(ch);
  });
  return total;
}

function detectMaternityFromText(emp) {
  const text = `${emp?.fio || ""} ${emp?.notes || ""}`;
  return /декрет/i.test(text);
}

function formatMaternityExport(emp) {
  normalizeEmployeeRecord(emp);
  return emp.maternityLeave ? "Да" : "";
}

function parseMaternityImport(value, fio = "") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (["да", "yes", "1", "true", "+"].includes(raw)) return true;
  if (["нет", "no", "0", "false", "—", "-", ""].includes(raw)) {
    return raw ? false : detectMaternityFromText({ fio });
  }
  return detectMaternityFromText({ fio });
}

function inferEmployeeEmploymentFields(emp) {
  const fio = (emp?.fio || "").trim();
  const role = (emp?.role || "").trim();
  if (/штуркин/i.test(fio)) {
    return { employmentForm: "договор", personType: "ИП" };
  }
  if (/оказание\s*услуг/i.test(role)) {
    return { employmentForm: "ГПХ", personType: "Самозанятый" };
  }
  return { employmentForm: "Трудовой договор", personType: "ФЛ" };
}

function normalizeEmployeeRecord(emp) {
  if (!emp) return emp;
  const inferred = inferEmployeeEmploymentFields(emp);
  if (!emp.employmentForm) emp.employmentForm = inferred.employmentForm;
  if (!emp.personType) emp.personType = inferred.personType;
  if (emp.maternityLeave === undefined || emp.maternityLeave === null) {
    emp.maternityLeave = detectMaternityFromText(emp);
  }
  return emp;
}

function normalizeAllEmployees() {
  walkDepartments(state.data.companies, (dept) => {
    dept.employees.forEach(normalizeEmployeeRecord);
  });
}

function isMaternityEmployee(emp) {
  normalizeEmployeeRecord(emp);
  return !!emp.maternityLeave;
}

function isServicesEmploymentEmployee(emp) {
  normalizeEmployeeRecord(emp);
  return emp.employmentForm === "ГПХ"
    || emp.employmentForm === "договор"
    || /оказание\s*услуг/i.test(emp.role || "");
}

function isLaborEmploymentEmployee(emp) {
  normalizeEmployeeRecord(emp);
  return emp.employmentForm === "Трудовой договор";
}

function isTreeFilterActive() {
  return state.maternityFilterOnly || !!state.employmentFilter;
}

function isFilterSeedEmployee(emp) {
  if (state.maternityFilterOnly && !isMaternityEmployee(emp)) return false;
  if (state.employmentFilter === "labor" && !isLaborEmploymentEmployee(emp)) return false;
  if (state.employmentFilter === "services" && !isServicesEmploymentEmployee(emp)) return false;
  return true;
}

let treeFilterCache = null;

function invalidateTreeFilterCache() {
  treeFilterCache = null;
}

function buildTreeFilterContext() {
  if (treeFilterCache) return treeFilterCache;

  const visibleDeptIds = new Set();
  const visibleEmpIds = new Set();

  function markDeptPath(dept) {
    let cursor = dept;
    while (cursor) {
      visibleDeptIds.add(cursor.id);
      cursor = findDepartmentParent(cursor.id);
    }
  }

  function markManagerChain(emp) {
    let mgrId = emp?.managerId;
    const seen = new Set();
    while (mgrId && !seen.has(mgrId)) {
      seen.add(mgrId);
      visibleEmpIds.add(mgrId);
      const mgr = getEmployeeByIdAnywhere(mgrId);
      const mgrDept = findEmployeeDepartment(mgrId);
      if (mgrDept) markDeptPath(mgrDept);
      mgrId = mgr?.managerId || null;
    }
  }

  walkDepartments(state.data.companies, (dept) => {
    dept.employees.forEach((emp) => {
      if (!isFilterSeedEmployee(emp)) return;
      visibleEmpIds.add(emp.id);
      markDeptPath(dept);
      markManagerChain(emp);
    });
  });

  treeFilterCache = { visibleDeptIds, visibleEmpIds };
  return treeFilterCache;
}

function countFilteredEmployeesRecursive(node) {
  const { visibleDeptIds, visibleEmpIds } = buildTreeFilterContext();
  if (!visibleDeptIds.has(node.id)) return 0;
  let total = (node.employees || []).filter((e) => visibleEmpIds.has(e.id)).length;
  (node.children || []).forEach((ch) => {
    total += countFilteredEmployeesRecursive(ch);
  });
  return total;
}

function isDeptVisibleInTreeFilter(deptId) {
  if (!isTreeFilterActive()) return true;
  return buildTreeFilterContext().visibleDeptIds.has(deptId);
}

function filterEmployeesForTree(dept) {
  if (!isTreeFilterActive()) return dept.employees || [];
  const { visibleEmpIds } = buildTreeFilterContext();
  return (dept.employees || []).filter((e) => visibleEmpIds.has(e.id));
}

function ensureTreeFilterSelection() {
  if (!isTreeFilterActive()) return;
  const { visibleDeptIds, visibleEmpIds } = buildTreeFilterContext();
  if (!visibleDeptIds.size) {
    state.selectedDeptId = null;
    state.selectedEmployeeId = null;
    return;
  }
  if (!state.selectedDeptId || !visibleDeptIds.has(state.selectedDeptId)) {
    state.selectedDeptId = [...visibleDeptIds][0];
    expandDeptAncestors(state.selectedDeptId);
  }
  const dep = getCurrentDept();
  if (!dep?.employees.some((e) => e.id === state.selectedEmployeeId && visibleEmpIds.has(e.id))) {
    state.selectedEmployeeId = dep?.employees.find((e) => visibleEmpIds.has(e.id))?.id || null;
  }
}

function getGeneralDirectorCompanies(fio) {
  const key = (fio || "").trim().toLowerCase();
  if (!key) return [];
  const companies = new Set();
  state.data.companies.forEach((company) => {
    walkDepartments(company.children || [], (d) => {
      (d.employees || []).forEach((e) => {
        if (
          (e.fio || "").trim().toLowerCase() === key &&
          /генеральный директор/i.test(e.role || "")
        ) {
          companies.add(company.name);
        }
      });
    });
  });
  return [...companies];
}

function getEmployeeOtherCompanies(fio, currentCompanyName) {
  const key = (fio || "").trim().toLowerCase();
  if (!key) return [];
  const companies = new Set();
  state.data.companies.forEach((company) => {
    walkDepartments(company.children || [], (d) => {
      (d.employees || []).forEach((e) => {
        if ((e.fio || "").trim().toLowerCase() === key) {
          companies.add(company.name);
        }
      });
    });
  });
  companies.delete(currentCompanyName);
  return [...companies];
}

function getCompanyNameByDeptId(deptId) {
  let name = "";
  state.data.companies.forEach((company) => {
    if (name) return;
    if (findDepartmentById(deptId, company.children || [])) name = company.name;
  });
  return name;
}

function isManager(emp) {
  if (!emp) return false;
  if (emp.level === "Head" || emp.level === "Lead") return true;
  return /руковод/i.test(emp.role || "");
}

const LEVEL_RANK = { Head: 0, Lead: 1, Senior: 2, Middle: 3, Junior: 4 };

function levelRank(level) {
  return LEVEL_RANK[level] ?? 99;
}

function roleText(role) {
  return (role || "").toLowerCase();
}

function isTopDirectorRole(role) {
  const r = roleText(role);
  return /генеральный директор|исполнительный директор/.test(r);
}

function isDeptHeadRole(role) {
  const r = roleText(role);
  if (/замест/.test(r)) return false;
  const markers = [
    "генеральный директор",
    "коммерческий директор",
    "финансовый директор",
    "технический директор",
    "директор департамента",
    "директор по персоналу",
    "руководитель проектного офиса",
    "руководитель отдела",
    "руководитель департамента",
    "начальник отдела",
    "главный бухгалтер",
  ];
  if (markers.some((m) => r.includes(m))) return true;
  // "Директор по ..." чаще функциональная роль, а не head подразделения.
  if (r.startsWith("директор ") && !/главн|замест|проект|директор по/.test(r)) return true;
  return false;
}

function isSubHeadRole(role) {
  const r = roleText(role);
  if (/замест/.test(r) || isDeptHeadRole(role)) return false;
  return (
    /главный руководитель/.test(r) ||
    /руководитель группы/.test(r) ||
    /руководитель направления/.test(r) ||
    /руководитель проекта/.test(r) ||
    /руководитель по/.test(r) ||
    /руководитель технического/.test(r) ||
    /руководитель клиентского/.test(r) ||
    /руководитель разработки/.test(r)
  );
}

function isTrueOrgHead(emp) {
  return isDeptHeadRole(emp.role) || isSubHeadRole(emp.role);
}

function isIndividualContributor(emp) {
  const r = roleText(emp.role);
  return /специалист|консультант|инженер|аналитик|разработчик|дизайнер|бухгалтер|менеджер/.test(r)
    && !isTrueOrgHead(emp)
    && !/руковод|директор|начальник/.test(r);
}

function hierarchyRank(emp) {
  if (!emp) return 999;
  const r = roleText(emp.role);
  if (/генеральный директор/.test(r)) return -2;
  if (/исполнительный директор/.test(r)) return -1;
  if (isDeptHeadRole(emp.role)) return 0;
  if (isSubHeadRole(emp.role)) return 1;
  if (/замест/.test(r)) return 2;
  if (emp.level === "Lead" || (isManager(emp) && /руковод|директор/.test(r))) return 2;
  if (emp.level === "Head" && isTrueOrgHead(emp)) return 1;
  if (emp.level === "Head" || isIndividualContributor(emp)) return 5;
  return 3 + levelRank(emp.level);
}

function compareByHierarchy(a, b) {
  const dr = hierarchyRank(a) - hierarchyRank(b);
  return dr || a.fio.localeCompare(b.fio, "ru");
}

function findDeptHead(dept, excludeId) {
  const explicit = dept.employees
    .filter((e) => e.id !== excludeId && isDeptHeadRole(e.role))
    .sort(compareByHierarchy);
  if (explicit.length) return explicit[0];

  const subHeads = dept.employees
    .filter((e) => e.id !== excludeId && isSubHeadRole(e.role))
    .sort(compareByHierarchy);
  if (subHeads.length) return subHeads[0];

  return null;
}

function isManagerFromOversightChain(manager, dept) {
  if (!manager || !dept) return false;
  let oversight = findOversightDepartment(dept.id);
  while (oversight) {
    if (oversight.employees.some((e) => e.id === manager.id)) return true;
    oversight = findOversightDepartment(oversight.id);
  }
  return false;
}

function findOversightManager(oversightDept) {
  const managers = oversightDept.employees.filter(isManager).sort(compareByHierarchy);
  const deputy = managers.find((e) => /замест/.test(roleText(e.role)));
  if (deputy) return deputy;
  return findDeptHead(oversightDept) || managers[0] || null;
}

const DIRECTORATE_NESTING = {
  "Техническая дирекция": [
    "ОТДЕЛ РАЗРАБОТКИ",
    "ПРОЕКТНЫЙ ОФИС",
    "ОТДЕЛ КОНТРОЛЯ КАЧЕСТВА",
    "ОТДЕЛ НАСТРОЙКИ ПРОДУКТОВ",
    "Отдел по развитию AI-продуктов",
    "ОТДЕЛ ТП",
  ],
};

function normDeptName(name) {
  return (name || "").trim().toLowerCase();
}

function findDeptInTreeByName(name) {
  let found = null;
  walkDepartments(state.data.companies, (d) => {
    if (normDeptName(d.name) === normDeptName(name)) found = d;
  });
  return found;
}

function getEmployeeByIdAnywhere(id) {
  if (!id) return null;
  for (const company of state.data.companies) {
    const direct = (company.employees || []).find((e) => e.id === id);
    if (direct) return direct;
    let found = null;
    walkDepartments(company.children || [], (d) => {
      if (found) return;
      found = (d.employees || []).find((e) => e.id === id) || null;
    });
    if (found) return found;
  }
  return null;
}

function findCompanyByDeptId(deptId) {
  if (!deptId) return null;
  for (const company of state.data.companies) {
    if (findDepartmentById(deptId, company.children || [])) return company;
  }
  return null;
}

function isEmployeeInCompany(empId, company) {
  if (!empId || !company) return false;
  if ((company.employees || []).some((e) => e.id === empId)) return true;
  let found = false;
  walkDepartments(company.children || [], (d) => {
    if ((d.employees || []).some((e) => e.id === empId)) found = true;
  });
  return found;
}

function buildCompanyEmployeeNameMap(company) {
  const map = new Map();
  if (!company) return map;
  (company.employees || []).forEach((e) => map.set(e.id, e.fio || ""));
  walkDepartments(company.children || [], (d) => {
    (d.employees || []).forEach((e) => map.set(e.id, e.fio || ""));
  });
  return map;
}

function managerNameForExport(company, managerId) {
  if (!managerId) return "—";
  return buildCompanyEmployeeNameMap(company).get(managerId) || "—";
}

function findMappedDirectorateDept(deptName) {
  const n = normDeptName(deptName);
  for (const [directorateName, children] of Object.entries(DIRECTORATE_NESTING)) {
    if (children.some((c) => normDeptName(c) === n)) {
      return findDeptInTreeByName(directorateName);
    }
  }
  return null;
}

function findOversightDepartment(deptId) {
  let parent = findDepartmentParent(deptId);
  while (parent) {
    if (parent.employees?.length) return parent;
    parent = findDepartmentParent(parent.id);
  }
  const dept = findDepartmentById(deptId);
  return dept ? findMappedDirectorateDept(dept.name) : null;
}

function restructureCompanyDirectorates(company) {
  if (!company?.children?.length) return;

  for (const [directorateName, childNames] of Object.entries(DIRECTORATE_NESTING)) {
    const directorate = company.children.find((d) => normDeptName(d.name) === normDeptName(directorateName));
    if (!directorate) continue;

    directorate.children = directorate.children || [];
    const childNorms = new Set(childNames.map(normDeptName));
    const toMove = [];

    company.children = company.children.filter((d) => {
      if (normDeptName(d.name) === normDeptName(directorateName)) return true;
      if (childNorms.has(normDeptName(d.name))) {
        toMove.push(d);
        return false;
      }
      return true;
    });

    toMove.forEach((d) => {
      if (!directorate.children.some((c) => c.id === d.id)) directorate.children.push(d);
    });
  }
}

function normalizeOrgTree() {
  state.data.companies.forEach(restructureCompanyDirectorates);
}

function assignParentDeptManager(dept) {
  const head = findDeptHead(dept);
  if (!head || !isTrueOrgHead(head)) return;

  const oversight = findOversightDepartment(dept.id);
  if (!oversight) {
    if (isDeptHeadRole(head.role) && !head.managerId) head.managerId = null;
    return;
  }

  const currentMgr = getEmployeeByIdAnywhere(head.managerId);
  if (head.managerId && isValidManager(head, currentMgr, dept)) return;

  const parentManager = findOversightManager(oversight);
  if (parentManager && parentManager.id !== head.id) head.managerId = parentManager.id;
}

function collectManagerCandidates(deptId, employeeId) {
  const dept = findDepartmentById(deptId);
  if (!dept) return [];

  const groups = [];
  const seen = new Set();

  function addGroup(label, department, filterFn) {
    const items = [];
    department.employees.forEach((emp) => {
      if (emp.id === employeeId || seen.has(emp.id)) return;
      if (filterFn && !filterFn(emp)) return;
      seen.add(emp.id);
      items.push({ emp, dept: department });
    });
    if (items.length) {
      groups.push({
        label,
        items: items.sort((a, b) => compareByHierarchy(a.emp, b.emp)),
      });
    }
  }

  // В текущем отделе — только руководители уровня Head (без Lead/специалистов).
  addGroup("Руководители отдела", dept, (emp) => (
    emp.level === "Head" || isTopDirectorRole(emp.role) || isDeptHeadRole(emp.role)
  ));

  const chain = [];
  const chainIds = new Set();
  let oversight = findOversightDepartment(deptId);
  while (oversight && !chainIds.has(oversight.id)) {
    chain.push(oversight);
    chainIds.add(oversight.id);
    oversight = findOversightDepartment(oversight.id);
  }

  // Вышестоящие подразделения — руководители и lead-роли.
  chain.forEach((d) => addGroup(`↑ ${d.name}`, d, (emp) => (
    isManager(emp) || hierarchyRank(emp) < 4
  )));

  // Руководители из соседних веток того же родителя (например, Смирнова для техподдержки).
  const parent = findDepartmentParent(deptId);
  if (parent) {
    (parent.children || []).forEach((branch) => {
      if (branch.id === deptId) return;
      walkDepartments([branch], (d) => {
        const items = [];
        (d.employees || []).forEach((emp) => {
          if (emp.id === employeeId || seen.has(emp.id)) return;
          if (emp.level !== "Head" && !isDeptHeadRole(emp.role)) return;
          seen.add(emp.id);
          items.push({ emp, dept: d });
        });
        if (items.length) {
          groups.push({
            label: `↔ ${d.name}`,
            items: items.sort((a, b) => compareByHierarchy(a.emp, b.emp)),
          });
        }
      });
    });
  }

  return groups;
}

function sortEmployeeTreeNodes(nodes) {
  nodes.sort((a, b) => compareByHierarchy(a.emp, b.emp));
  nodes.forEach((n) => sortEmployeeTreeNodes(n.reports));
  return nodes;
}

function flattenEmployeeTree(nodes, out = []) {
  nodes.forEach((node) => {
    out.push(node.emp);
    flattenEmployeeTree(node.reports, out);
  });
  return out;
}

function inferManagerId(dept, emp) {
  const others = dept.employees.filter((e) => e.id !== emp.id);
  if (!others.length) return null;

  const myRank = hierarchyRank(emp);
  const deptHead = findDeptHead(dept, emp.id);

  if (isDeptHeadRole(emp.role)) {
    if (isTopDirectorRole(emp.role)) return null;
    if (deptHead && deptHead.id !== emp.id) return deptHead.id;
    return null;
  }

  if ((emp.level === "Head" || isSubHeadRole(emp.role)) && deptHead && isTrueOrgHead(emp)) {
    return deptHead.id;
  }

  const idx = dept.employees.findIndex((e) => e.id === emp.id);
  const branchMgr = dept.employees
    .slice(0, idx)
    .reverse()
    .find((e) => hierarchyRank(e) < myRank && (isSubHeadRole(e.role) || e.level === "Lead" || isManager(e)));
  if (branchMgr) return branchMgr.id;

  if (deptHead && hierarchyRank(deptHead) < myRank) return deptHead.id;

  const superiors = others
    .filter((e) => hierarchyRank(e) < myRank)
    .sort(compareByHierarchy);

  return superiors[superiors.length - 1]?.id || null;
}

function isValidManager(emp, manager, dept) {
  if (!manager) {
    if (isDeptHeadRole(emp.role)) return !findOversightDepartment(dept?.id);
    if (isSubHeadRole(emp.role)) return !findOversightDepartment(dept?.id);
    return true;
  }
  if (manager.id === emp.id) return false;
  if (dept?.employees?.some((e) => e.id === manager.id) && manager.level === "Head") return true;
  const company = findCompanyByDeptId(dept?.id);
  if (
    company &&
    isEmployeeInCompany(manager.id, company) &&
    isManager(manager) &&
    hierarchyRank(manager) < hierarchyRank(emp)
  ) return true;
  if (
    company &&
    isEmployeeInCompany(manager.id, company) &&
    isManager(manager) &&
    !dept?.employees?.some((e) => e.id === manager.id) &&
    (emp.level === "Head" || isTrueOrgHead(emp))
  ) return true;
  if (isManagerFromOversightChain(manager, dept) && isTrueOrgHead(emp)) return true;
  if (hierarchyRank(manager) < hierarchyRank(emp)) return true;
  if (isDeptHeadRole(emp.role) && isDeptHeadRole(manager.role)) {
    const oversight = findOversightDepartment(dept?.id);
    const parentHead = oversight ? findDeptHead(oversight) : null;
    return parentHead?.id === manager.id;
  }
  return false;
}

function normalizeEmployeeLevel(emp) {
  if (!isIndividualContributor(emp)) return;
  const r = roleText(emp.role);
  if (/младш|junior/.test(r)) emp.level = "Junior";
  else if (/главный специалист|1-й|1й|первой категории/.test(r)) emp.level = "Senior";
  else emp.level = "Middle";
}

function syncDeptHierarchy(dept, { preserveManagers = false } = {}) {
  dept.employees.forEach((e) => {
    normalizeEmployeeLevel(e);
    if (e.managerId && !getEmployeeByIdAnywhere(e.managerId)) e.managerId = null;
  });

  if (!preserveManagers) {
    dept.employees.forEach((e) => {
      const deptHead = findDeptHead(dept);
      if (deptHead && e.id === deptHead.id) return;

      const mgr = getEmployeeByIdAnywhere(e.managerId);
      if (!e.managerId || !isValidManager(e, mgr, dept)) {
        e.managerId = inferManagerId(dept, e);
      }
    });

    assignParentDeptManager(dept);
  }

  const tree = sortEmployeeTreeNodes(buildEmployeeTree(dept.employees));
  const ordered = flattenEmployeeTree(tree);
  const seen = new Set(ordered.map((e) => e.id));
  dept.employees.filter((e) => !seen.has(e.id)).sort(compareByHierarchy).forEach((e) => ordered.push(e));
  dept.employees = ordered;
}

function syncAllHierarchy() {
  walkDepartments(state.data.companies, (d) => syncDeptHierarchy(d));
}

function assignManagersInDept(dept) {
  const emps = dept.employees;
  emps.forEach((e) => { if (e.managerId === undefined) e.managerId = null; });
  if (!emps.length || emps.some((e) => e.managerId)) return;

  const managers = emps.filter(isManager);
  if (!managers.length) return;

  const head = managers.find((m) => m.level === "Head") || managers[0];
  head.managerId = null;
  const leads = managers.filter((m) => m !== head && m.level === "Lead");
  leads.forEach((l) => { l.managerId = head.id; });

  const workers = emps.filter((e) => !isManager(e));
  workers.forEach((w, i) => {
    if (leads.length) w.managerId = leads[i % leads.length].id;
    else w.managerId = head.id;
  });

  managers.filter((m) => m !== head && !leads.includes(m)).forEach((m) => {
    if (!m.managerId) m.managerId = head.id;
  });
}

function assignManagersAll({ normalizeTree = false } = {}) {
  if (normalizeTree) normalizeOrgTree();
  walkDepartments(state.data.companies, (d) => assignManagersInDept(d));
  syncAllHierarchy();
}

function syncSelectAllCheckbox() {
  const all = allDeptIds();
  const cb = el("selectAllPrint");
  if (!cb) return;
  const n = state.printSelected.size;
  cb.checked = n > 0 && n === all.length;
  cb.indeterminate = n > 0 && n < all.length;
}

function deptHasSelectedDescendant(id) {
  const node = findDepartmentById(id);
  if (!node?.children?.length) return false;
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.pop();
    if (state.printSelected.has(n.id)) return true;
    if (n.children?.length) stack.push(...n.children);
  }
  return false;
}

function selectPrintWithAncestors(id) {
  state.printSelected.add(id);
  let parent = findDepartmentParent(id);
  while (parent) {
    state.printSelected.add(parent.id);
    parent = findDepartmentParent(parent.id);
  }
}

function deselectPrintWithCleanup(id) {
  state.printSelected.delete(id);
  let parent = findDepartmentParent(id);
  while (parent) {
    if (!deptHasSelectedDescendant(parent.id)) state.printSelected.delete(parent.id);
    parent = findDepartmentParent(parent.id);
  }
}

function renderTree() {
  const tree = el("tree");
  tree.innerHTML = "";

  function renderNode(node, container) {
    if (isTreeFilterActive() && !isDeptVisibleInTreeFilter(node.id)) return;

    const item = document.createElement("div");
    item.className = "tree-item";

    const row = document.createElement("div");
    row.className = "tree-row" + (node.id === state.selectedDeptId ? " active" : "");

    const hasChildren = !!(node.children?.length);
    const collapsed = state.collapsed.has(node.id);

    const printCb = document.createElement("input");
    printCb.type = "checkbox";
    printCb.className = "tree-print-cb";
    printCb.checked = state.printSelected.has(node.id);
    printCb.title = "Включить в PDF";
    printCb.onclick = (e) => {
      e.stopPropagation();
      if (printCb.checked) selectPrintWithAncestors(node.id);
      else deselectPrintWithCleanup(node.id);
      syncSelectAllCheckbox();
      renderTree();
    };

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tree-toggle" + (hasChildren ? "" : " placeholder");
    toggle.textContent = collapsed ? "▶" : "▼";
    toggle.onclick = (e) => {
      e.stopPropagation();
      if (!hasChildren) return;
      if (collapsed) state.collapsed.delete(node.id);
      else state.collapsed.add(node.id);
      renderTree();
    };

    const label = document.createElement("div");
    label.className = "tree-label";
    label.innerHTML = `<div class="name">${node.name}</div><div class="meta">${countEmployeesRecursive(node)} сотр.</div>`;
    label.onclick = () => {
      if (!confirmDiscardOrSaveForm()) return;
      el("employeeSearch").value = "";
      selectDepartment(node.id);
      renderAll();
    };

    const drag = document.createElement("span");
    drag.className = "tree-drag";
    drag.textContent = "⠿";
    drag.title = "Перетащить";
    drag.draggable = true;
    drag.ondragstart = (e) => {
      e.stopPropagation();
      if (!requireAuth()) {
        e.preventDefault();
        return;
      }
      state.dragDeptId = node.id;
    };

    row.ondragover = (e) => e.preventDefault();
    row.ondrop = (e) => {
      e.preventDefault();
      if (!requireAuth()) return;
      const sourceId = state.dragDeptId;
      if (!sourceId || sourceId === node.id) return;
      let cursor = findDepartmentById(node.id);
      while (cursor) {
        if (cursor.id === sourceId) return toast("Нельзя перенести в потомка");
        cursor = findDepartmentParent(cursor.id);
      }
      const moved = removeDepartmentById(sourceId);
      if (!moved) return;
      node.children = node.children || [];
      node.children.push(moved);
      state.collapsed.delete(node.id);
      syncAllHierarchy();
      persistDataChange();
      status(`Перенесено: ${moved.name}`);
      renderAll();
    };

    row.append(printCb, toggle, label, drag);
    item.appendChild(row);

    if (hasChildren) {
      const childWrap = document.createElement("div");
      childWrap.className = "tree-children" + (collapsed ? " collapsed" : "");
      node.children.forEach((c) => renderNode(c, childWrap));
      item.appendChild(childWrap);
    }

    container.appendChild(item);
  }

  state.data.companies.forEach((root) => renderNode(root, tree));
  syncSelectAllCheckbox();
  updateToggleTreeBtn();
}

function collapsibleDeptIds() {
  return allDeptIds().filter((id) => findDepartmentById(id)?.children?.length);
}

function isTreeFullyExpanded() {
  const ids = collapsibleDeptIds();
  if (!ids.length) return true;
  return ids.every((id) => !state.collapsed.has(id));
}

function updateToggleTreeBtn() {
  const btn = el("toggleTreeBtn");
  if (!btn) return;
  const expanded = isTreeFullyExpanded();
  btn.textContent = expanded ? "Свернуть всё" : "Раскрыть всё";
  btn.classList.toggle("btn-danger", expanded);
  btn.classList.toggle("btn-ghost", !expanded);
  btn.setAttribute("aria-pressed", expanded ? "true" : "false");
}

function toggleTreeExpandAll() {
  if (isTreeFullyExpanded()) {
    collapsibleDeptIds().forEach((id) => state.collapsed.add(id));
  } else {
    state.collapsed.clear();
  }
  renderTree();
}

function matchesSearch(e, q) {
  if (!q) return true;
  return [e.fio, e.role, e.email, e.phone, e.employmentForm, e.personType].join(" ").toLowerCase().includes(q.toLowerCase());
}

function filterEmployeeTree(nodes, q) {
  if (!q) return nodes;
  const out = [];
  for (const node of nodes) {
    const reports = filterEmployeeTree(node.reports, q);
    if (matchesSearch(node.emp, q) || reports.length) {
      out.push({ emp: node.emp, reports });
    }
  }
  return out;
}

function renderEmployees() {
  const list = el("employeesList");
  list.innerHTML = "";
  const dep = getCurrentDept();
  if (!dep) { list.innerHTML = "<div class='muted'>Выберите подразделение слева</div>"; return; }
  if (isTreeFilterActive() && !isDeptVisibleInTreeFilter(dep.id)) {
    list.innerHTML = "<div class='muted'>Подразделение скрыто фильтром</div>";
    return;
  }

  const visibleEmployees = filterEmployeesForTree(dep);

  const q = el("employeeSearch").value.trim();
  if (q && !visibleEmployees.some((e) => matchesSearch(e, q))) {
    const global = searchEmployeesGlobal(q);
    if (!global.length) {
      list.innerHTML = "<div class='muted'>Никого не найдено</div>";
      return;
    }
  }

  if (!visibleEmployees.length) {
    list.innerHTML = isTreeFilterActive()
      ? "<div class='muted'>В подразделении нет сотрудников по фильтру</div>"
      : "<div class='muted'>В подразделении нет сотрудников</div>";
    return;
  }

  const tree = filterEmployeeTree(buildEmployeeTree(visibleEmployees), q);
  if (!tree.length) { list.innerHTML = "<div class='muted'>Никого не найдено</div>"; return; }

  function appendNode(node, depth) {
    const e = node.emp;
    const mgr = isManager(e);
    const card = document.createElement("div");
    card.className = "employee-card";
    card.style.setProperty("--emp-depth", depth);
    if (depth > 0) card.classList.add("employee-card-sub");
    if (mgr) card.classList.add("employee-card-mgr");
    if (state.selectedEmployeeId === e.id) card.classList.add("active");
    card.innerHTML = `<strong>${e.fio}</strong><div class="small">${e.role} • ${e.level}</div><div class="small">${e.email || "—"}</div>`;
    card.onclick = () => {
      if (e.id === state.selectedEmployeeId) return;
      if (!confirmDiscardOrSaveForm()) return;
      state.selectedEmployeeId = e.id;
      fillEmployeeForm();
      renderEmployees();
    };
    list.appendChild(card);
    node.reports.forEach((r) => appendNode(r, depth + 1));
  }

  tree.forEach((node) => appendNode(node, 0));
}

function fillEmployeeForm() {
  const dep = getCurrentDept();
  const e = getEmployeeById(state.selectedEmployeeId);
  const map = {
    fFio: "fio",
    fRole: "role",
    fLevel: "level",
    fPhone: "phone",
    fEmail: "email",
    fEmploymentForm: "employmentForm",
    fPersonType: "personType",
  };
  Object.entries(map).forEach(([fid, key]) => {
    const node = el(fid);
    if (!node) return;
    node.value = e ? (e[key] || (key === "level" ? "Middle" : key === "employmentForm" ? "Трудовой договор" : key === "personType" ? "ФЛ" : "")) : "";
  });
  const maternityCb = el("fMaternityLeave");
  if (maternityCb) maternityCb.checked = !!(e && normalizeEmployeeRecord(e).maternityLeave);
  const gdCompanies = e ? getGeneralDirectorCompanies(e.fio) : [];
  el("fGeneralCompanies").value = gdCompanies.length ? gdCompanies.join("; ") : "—";
  const currentCompany = dep ? getCompanyNameByDeptId(dep.id) : "";
  const alsoIn = e ? getEmployeeOtherCompanies(e.fio, currentCompany) : [];
  el("fAlsoInOrgs").value = alsoIn.length ? alsoIn.join("; ") : "—";

  const mgrSel = el("fManager");
  mgrSel.innerHTML = '<option value="">— нет —</option>';
  const optionIds = new Set();
  if (dep) {
    collectManagerCandidates(dep.id, state.selectedEmployeeId).forEach(({ label, items }) => {
      const group = document.createElement("optgroup");
      group.label = label;
      items.forEach(({ emp }) => {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = `${emp.fio} · ${emp.role || emp.level}`;
        optionIds.add(emp.id);
        if (e?.managerId === emp.id) opt.selected = true;
        group.appendChild(opt);
      });
      mgrSel.appendChild(group);
    });
  }
  if (e?.managerId && !optionIds.has(e.managerId)) {
    const externalMgr = getEmployeeByIdAnywhere(e.managerId);
    if (externalMgr) {
      const extra = document.createElement("option");
      extra.value = externalMgr.id;
      extra.textContent = `${externalMgr.fio} · ${externalMgr.role || externalMgr.level}`;
      extra.selected = true;
      mgrSel.appendChild(extra);
    }
  }
  state.formDirty = false;
  updateDirtyIndicator();
}

function readEmployeeForm() {
  const managerId = el("fManager")?.value || null;
  const fHireDate = el("fHireDate");
  const fNotes = el("fNotes");
  return {
    fio: el("fFio")?.value.trim() || "",
    role: el("fRole")?.value.trim() || "",
    level: el("fLevel")?.value || "Middle",
    hireDate: fHireDate ? fHireDate.value : "",
    phone: el("fPhone")?.value.trim() || "",
    email: el("fEmail")?.value.trim() || "",
    employmentForm: el("fEmploymentForm")?.value || "Трудовой договор",
    personType: el("fPersonType")?.value || "ФЛ",
    maternityLeave: !!el("fMaternityLeave")?.checked,
    notes: fNotes ? fNotes.value.trim() : "",
    managerId
  };
}

function renderAll() {
  invalidateTreeFilterCache();
  if (isTreeFilterActive()) ensureTreeFilterSelection();
  renderTree();
  renderEmployees();
  fillEmployeeForm();
  updateStatsUI();
  const dep = getCurrentDept();
  status(dep ? dep.name : "Выберите отдел");
}

function updateAuthUI() {
  document.body.classList.remove("is-readonly");

  ["fFio", "fRole", "fLevel", "fPhone", "fEmail", "fEmploymentForm", "fPersonType", "fMaternityLeave", "fManager"].forEach((id) => {
    const node = el(id);
    if (!node) return;
    if (node.tagName === "SELECT") node.disabled = false;
    else if (node.type === "checkbox") node.disabled = false;
    else node.readOnly = false;
  });
  el("fGeneralCompanies").readOnly = true;
  el("fAlsoInOrgs").readOnly = true;
}

function bindAuthGuard() {
  // Авторизация отключена.
}

function toPlainRows() {
  const rows = [];
  walkDepartments(state.data.companies, (d, path) => {
    d.employees.forEach((e) => {
      normalizeEmployeeRecord(e);
      rows.push({
        companyPath: path.join(" / "),
        departmentId: d.id,
        departmentName: d.name,
        employeeId: e.id,
        managerId: e.managerId || "",
        fio: e.fio, role: e.role, level: e.level,
        hireDate: e.hireDate, phone: e.phone, email: e.email,
        employmentForm: e.employmentForm, personType: e.personType,
        "Декрет": formatMaternityExport(e),
        maternityLeave: !!e.maternityLeave,
        notes: e.notes
      });
    });
  });
  return rows;
}

function exportExcel() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toPlainRows()), "employees");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["key", "value"],
    ["name", state.data.meta.name],
    ["passwordHash", state.data.meta.passwordHash],
    ["updatedAt", new Date().toISOString()]
  ]), "_meta");
  XLSX.writeFile(wb, "structa.xlsx");
  status("Excel экспортирован");
}

function exportExcelPretty() {
  const wb = XLSX.utils.book_new();
  const rows = [[
    "Тип",
    "Контур",
    "Подразделение / Сотрудник",
    "ФИО",
    "Должность",
    "Руководитель",
    "Уровень",
    "Организация",
    "Форма трудовых отношений",
    "Тип лица",
    "Декрет",
  ]];
  const rowMeta = [{}];

  function indent(text, level) {
    return `${"  ".repeat(Math.max(0, level))}${text}`;
  }

  function pushRow(values, level = 0) {
    rows.push(values);
    rowMeta.push({ level });
  }

  function walkDept(company, dept, depth) {
    const managerNames = buildCompanyEmployeeNameMap(company);
    pushRow([
      "Отдел",
      `L${depth + 1}`,
      indent(dept.name, depth),
      "",
      "",
      "",
      "",
      company.name,
      "",
      "",
      "",
    ], depth);

    (dept.employees || []).forEach((e) => {
      normalizeEmployeeRecord(e);
      pushRow([
        "Сотрудник",
        `L${depth + 2}`,
        indent("• карточка", depth + 1),
        e.fio || "",
        e.role || "",
        managerNames.get(e.managerId) || "—",
        e.level || "",
        company.name,
        e.employmentForm || "",
        e.personType || "",
        formatMaternityExport(e),
      ], depth + 1);
    });

    (dept.children || []).forEach((child) => walkDept(company, child, depth + 1));
  }

  state.data.companies.forEach((company) => {
    const managerNames = buildCompanyEmployeeNameMap(company);
    pushRow([
      "Организация",
      "L0",
      company.name,
      "",
      "",
      "",
      "",
      company.name,
      "",
      "",
      "",
    ], 0);

    (company.employees || []).forEach((e) => {
      normalizeEmployeeRecord(e);
      pushRow([
        "Сотрудник",
        "L1",
        indent("• карточка", 1),
        e.fio || "",
        e.role || "",
        managerNames.get(e.managerId) || "—",
        e.level || "",
        company.name,
        e.employmentForm || "",
        e.personType || "",
        formatMaternityExport(e),
      ], 1);
    });

    (company.children || []).forEach((dept) => walkDept(company, dept, 1));
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 8 },
    { wch: 42 },
    { wch: 34 },
    { wch: 42 },
    { wch: 32 },
    { wch: 10 },
    { wch: 28 },
    { wch: 24 },
    { wch: 14 },
    { wch: 8 },
  ];
  ws["!rows"] = rowMeta;
  ws["!autofilter"] = { ref: `A1:K1` };
  ws["!outline"] = { above: false, left: false };

  XLSX.utils.book_append_sheet(wb, ws, "org-structure");
  XLSX.writeFile(wb, getExportExcelFileName());
  markClean();
  persistLocal();
  status("Выгрузка Excel готова");
}

function sanitizeFilePart(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "_");
}

function makeUniqueSheetName(base, used) {
  const cleaned = sanitizeFilePart(base || "team").replace(/_/g, " ").slice(0, 31) || "team";
  if (!used.has(cleaned)) {
    used.add(cleaned);
    return cleaned;
  }
  let i = 2;
  while (true) {
    const suffix = ` (${i})`;
    const candidate = `${cleaned.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    i += 1;
  }
}

function buildHeadWorkbook(companyName, headName, deptEntries) {
  const wb = XLSX.utils.book_new();
  const usedSheets = new Set();
  const companyNode = state.data.companies.find((c) => c.name === companyName);
  const companyEmployeeNameById = buildCompanyEmployeeNameMap(companyNode);
  const summary = [[
    "Руководитель",
    "Организация",
    "Подразделение",
    "Сотрудников",
  ]];

  deptEntries
    .slice()
    .sort((a, b) => a.pathText.localeCompare(b.pathText, "ru"))
    .forEach((entry) => {
      const dept = entry.dept;
      const rows = [[
        "Подразделение",
        "ФИО",
        "Должность",
        "Руководитель",
        "Уровень",
        "Форма трудовых отношений",
        "Тип лица",
        "Декрет",
        "Организация",
      ]];
      const deptEmployees = [];
      walkDepartments([dept], (localDept, localPath) => {
        const deptPathText = [companyName, ...localPath].join(" / ");
        (localDept.employees || []).forEach((e) => {
          deptEmployees.push({ employee: e, deptPathText });
        });
      });
      deptEmployees.forEach(({ employee: e, deptPathText }) => {
        normalizeEmployeeRecord(e);
        rows.push([
          deptPathText,
          e.fio || "",
          e.role || "",
          companyEmployeeNameById.get(e.managerId) || "—",
          e.level || "",
          e.employmentForm || "",
          e.personType || "",
          formatMaternityExport(e),
          companyName,
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 48 }, { wch: 32 }, { wch: 40 }, { wch: 30 }, { wch: 10 },
        { wch: 22 }, { wch: 14 }, { wch: 8 }, { wch: 28 },
      ];
      ws["!autofilter"] = { ref: "A1:I1" };
      const sheetName = makeUniqueSheetName(entry.pathText.split(" / ").pop(), usedSheets);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      summary.push([headName, companyName, entry.pathText, deptEmployees.length]);
    });

  const summaryWs = XLSX.utils.aoa_to_sheet(summary);
  summaryWs["!cols"] = [{ wch: 28 }, { wch: 28 }, { wch: 52 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, makeUniqueSheetName("Сводка", usedSheets));
  return wb;
}

function findEffectiveDeptHeadInCompany(companyRootChildren, dept) {
  let cur = dept;
  while (cur) {
    const head = findDeptHead(cur);
    if (head) return head;
    cur = findDepartmentParent(cur.id, companyRootChildren);
  }
  return null;
}

function downloadBlob(blob, fileName) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportByDepartments() {
  const groups = new Map();
  state.data.companies.forEach((company) => {
    walkDepartments(company.children || [], (dept, path) => {
      if (countEmployeesRecursive(dept) <= 0) return;
      const head = findEffectiveDeptHeadInCompany(company.children || [], dept);
      const parent = findDepartmentParent(dept.id, company.children || []);
      const parentHead = parent ? findEffectiveDeptHeadInCompany(company.children || [], parent) : null;

      // If parent already has same effective head, this subtree is already included.
      if ((parentHead?.id || "") === (head?.id || "")) return;

      const headFio = head?.fio?.trim() || "";
      const key = headFio ? `${company.name}::${headFio}` : `${company.name}::dept::${dept.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          companyName: company.name,
          headFio: headFio || "Без руководителя",
          depts: [],
        });
      }
      groups.get(key).depts.push({
        dept,
        pathText: [company.name, ...(path || [])].join(" / "),
      });
    });
  });
  const tasks = Array.from(groups.values()).map((g) => {
    const lastName = (g.headFio || "Без руководителя").split(" ")[0] || "Без_руководителя";
    const fileName = `${sanitizeFilePart(lastName)}_${sanitizeFilePart(g.companyName)}.xlsx`;
    return { ...g, fileName };
  });

  if (!tasks.length) {
    toast("Нет подразделений для выгрузки");
    return;
  }
  if (!confirm(`Скачать архив с ${tasks.length} файлами по подразделениям?`)) return;

  if (typeof JSZip === "undefined") {
    toast({ type: "error", title: "ZIP недоступен", message: "Не удалось загрузить JSZip." });
    return;
  }

  status(`Подготовка архива: ${tasks.length} файлов...`);
  const zip = new JSZip();
  tasks.forEach((t) => {
    const wb = buildHeadWorkbook(t.companyName, t.headFio, t.depts);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
    zip.file(t.fileName, bytes);
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const archiveName = `Подразделения_${stamp}.zip`;
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  downloadBlob(blob, archiveName);
  status(`Архив выгружен: ${tasks.length} файлов`);
}

function rowsToTree(rows) {
  const root = [], map = new Map();
  for (const r of rows) {
    const chain = String(r.companyPath || "").split(" / ").filter(Boolean);
    let parent = null, fullPath = "";
    chain.forEach((name, idx) => {
      fullPath = fullPath ? `${fullPath} / ${name}` : name;
      if (!map.has(fullPath)) {
        const dep = { id: uid("dep"), name, children: [], employees: [] };
        map.set(fullPath, dep);
        (parent ? parent.children : root).push(dep);
      }
      parent = map.get(fullPath);
      if (idx === chain.length - 1) {
        parent.employees.push({
          id: String(r.employeeId || uid("emp")),
          managerId: r.managerId ? String(r.managerId) : null,
          fio: r.fio || "", role: r.role || "", level: r.level || "Middle",
          hireDate: r.hireDate || "", phone: r.phone || "", email: r.email || "",
          employmentForm: r.employmentForm || "",
          personType: r.personType || "",
          maternityLeave: parseMaternityImport(r["Декрет"] ?? r.maternityLeave, r.fio || ""),
          notes: r.notes || ""
        });
      }
    });
  }
  return root;
}

function parseKonturLevel(kontur) {
  const m = String(kontur || "").trim().match(/^L(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
}

function cleanHierarchyNodeName(text) {
  return String(text || "").replace(/^\s+/, "").trim();
}

function hierarchyDeptContainer(deptByLevel, empLevel) {
  for (let level = empLevel - 1; level >= 0; level -= 1) {
    if (deptByLevel[level]) return deptByLevel[level].node;
  }
  return null;
}

function hierarchyParentContainer(deptByLevel, deptLevel, company) {
  for (let level = deptLevel - 1; level >= 0; level -= 1) {
    if (deptByLevel[level]) return deptByLevel[level].node;
  }
  return company;
}

function findOrCreateChildDept(parent, name) {
  const children = parent.children || (parent.children = []);
  let dept = children.find((d) => normDeptName(d.name) === normDeptName(name));
  if (!dept) {
    dept = { id: uid("dep"), name, children: [], employees: [] };
    children.push(dept);
  }
  return dept;
}

function hierarchySheetToCompanies(rows) {
  const companies = [];
  let currentCompany = null;
  let deptByLevel = {};

  rows.forEach((r) => {
    const type = String(r["Тип"] || "").trim();
    const org = String(r["Организация"] || "").trim();
    const kontur = parseKonturLevel(r["Контур"]);

    if (type === "Организация") {
      const orgName = org || cleanHierarchyNodeName(r["Подразделение / Сотрудник"]);
      if (!orgName) return;
      currentCompany = { id: uid("dep"), name: orgName, children: [], employees: [] };
      companies.push(currentCompany);
      deptByLevel = {};
      return;
    }
    if (!currentCompany) return;

    if (type === "Отдел") {
      const name = cleanHierarchyNodeName(r["Подразделение / Сотрудник"]);
      if (!name) return;
      const deptLevel = kontur ?? 2;
      Object.keys(deptByLevel).forEach((level) => {
        if (+level >= deptLevel) delete deptByLevel[level];
      });
      const parent = hierarchyParentContainer(deptByLevel, deptLevel, currentCompany);
      const dept = findOrCreateChildDept(parent, name);
      deptByLevel[deptLevel] = { name, node: dept };
      return;
    }

    if (type === "Сотрудник") {
      const fio = String(r["ФИО"] || "").trim();
      if (!fio) return;
      const empLevel = kontur ?? (Math.max(0, ...Object.keys(deptByLevel).map(Number)) + 1);
      const container = hierarchyDeptContainer(deptByLevel, empLevel) || currentCompany;
      container.employees.push(normalizeEmployeeRecord({
        id: uid("emp"),
        managerId: null,
        fio,
        role: String(r["Должность"] || "").trim(),
        level: String(r["Уровень"] || "").trim() || "Middle",
        hireDate: "",
        phone: "",
        email: "",
        employmentForm: String(r["Форма трудовых отношений"] || "").trim(),
        personType: String(r["Тип лица"] || "").trim(),
        maternityLeave: parseMaternityImport(r["Декрет"], fio),
        notes: "",
      }));
    }
  });

  return companies;
}

function collectHierarchyManagerRows(rows) {
  const out = [];
  let currentOrg = "";
  rows.forEach((r) => {
    const type = String(r["Тип"] || "").trim();
    if (type === "Организация") {
      currentOrg = String(r["Организация"] || "").trim()
        || cleanHierarchyNodeName(r["Подразделение / Сотрудник"]);
      return;
    }
    if (type !== "Сотрудник") return;
    const fio = String(r["ФИО"] || "").trim();
    if (!fio) return;
    out.push({
      companyPath: currentOrg,
      fio,
      managerName: String(r["Руководитель"] || "").trim(),
    });
  });
  return out;
}

function rowsFromDepartmentSheet(rows) {
  const out = [];
  rows.forEach((r) => {
    const fio = String(r["ФИО"] || "").trim();
    if (!fio) return;
    const org = String(r["Организация"] || "").trim();
    const dept = String(r["Подразделение"] || "").trim();
    out.push({
      companyPath: [org, dept].filter(Boolean).join(" / "),
      fio,
      role: String(r["Должность"] || "").trim(),
      level: String(r["Уровень"] || "").trim() || "Middle",
      employmentForm: String(r["Форма трудовых отношений"] || "").trim(),
      personType: String(r["Тип лица"] || "").trim(),
      maternityLeave: parseMaternityImport(r["Декрет"], fio),
      managerName: String(r["Руководитель"] || "").trim(),
    });
  });
  return out;
}

function normalizePersonName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function personNameTokens(name) {
  const parts = normalizePersonName(name).split(" ").filter(Boolean);
  return {
    surname: parts[0] || "",
    given: parts[1] || "",
    parts,
  };
}

function namesReferToSamePerson(a, b) {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  const ta = personNameTokens(a);
  const tb = personNameTokens(b);
  if (!ta.surname || ta.surname !== tb.surname) return false;
  if (!ta.given || !tb.given) return true;
  return ta.given[0] === tb.given[0]
    || ta.given.startsWith(tb.given.slice(0, 3))
    || tb.given.startsWith(ta.given.slice(0, 3));
}

function findEmployeesByManagerName(company, managerName, byCompanyAndName) {
  const mgrNorm = normalizePersonName(managerName);
  if (!mgrNorm || mgrNorm === "—") return [];

  const exact = byCompanyAndName.get(`${company}::${mgrNorm}`);
  if (exact?.length) return exact;

  const prefix = [];
  byCompanyAndName.forEach((emps, key) => {
    if (!key.startsWith(`${company}::`)) return;
    const fio = key.slice(company.length + 2);
    if (namesReferToSamePerson(managerName, fio)) prefix.push(...emps);
  });

  const seen = new Set();
  return prefix.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

function applyManagerNames(companies, rows) {
  const byCompanyAndName = new Map();
  walkDepartments(companies, (d, path) => {
    const company = path[0] || "";
    d.employees.forEach((e) => {
      const k = `${company}::${normalizePersonName(e.fio)}`;
      if (!byCompanyAndName.has(k)) byCompanyAndName.set(k, []);
      byCompanyAndName.get(k).push(e);
    });
  });

  rows.forEach((r) => {
    const chain = String(r.companyPath || "").split(" / ").filter(Boolean);
    const company = chain[0] || "";
    const fioKey = `${company}::${normalizePersonName(r.fio)}`;
    const mgrName = String(r.managerName || "").trim();
    if (!mgrName || mgrName === "—") return;
    const emps = byCompanyAndName.get(fioKey) || [];
    const mgrs = findEmployeesByManagerName(company, mgrName, byCompanyAndName);
    if (!emps.length || !mgrs.length) return;
    const manager = mgrs[0];
    emps.forEach((e) => { if (e.id !== manager.id) e.managerId = manager.id; });
  });
}

function importExcel(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: "array" });
      let rows = [];
      let companies = [];
      let isHierarchyImport = false;
      if (wb.Sheets.employees) {
        rows = XLSX.utils.sheet_to_json(wb.Sheets.employees, { defval: "" });
        companies = rowsToTree(rows);
      } else {
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const firstRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
        const headers = new Set(firstRows.length ? Object.keys(firstRows[0]) : []);
        if (headers.has("Тип") && headers.has("Организация")) {
          isHierarchyImport = true;
          companies = hierarchySheetToCompanies(firstRows);
          rows = collectHierarchyManagerRows(firstRows);
        } else if (headers.has("Подразделение") && headers.has("ФИО") && headers.has("Организация")) {
          rows = rowsFromDepartmentSheet(firstRows);
          companies = rowsToTree(rows);
        } else {
          rows = firstRows;
          companies = rowsToTree(rows);
        }
      }
      const metaRows = wb.Sheets._meta ? XLSX.utils.sheet_to_json(wb.Sheets._meta) : [];
      const passwordHash = metaRows.find((r) => r.key === "passwordHash")?.value || "";
      applyManagerNames(companies, rows);
      normalizeAllEmployees();
      state.data = { meta: { name: "StructaData", version: 1, passwordHash }, companies };
      state.selectedDeptId = state.data.companies[0]?.id || null;
      state.selectedEmployeeId = null;
      state.collapsed.clear();
      state.printSelected.clear();
      if (!isHierarchyImport) normalizeOrgTree();
      walkDepartments(state.data.companies, (d) => assignManagersInDept(d));
      walkDepartments(state.data.companies, (d) => syncDeptHierarchy(d, { preserveManagers: true }));
      state.loadedPath = resolveLoadedFilePath(file.name);
      refreshPathDisplay();
      persistDataChange();
      renderAll();
      status("Excel импортирован");
    } catch (e) { toast("Ошибка Excel: " + e.message); }
  };
  reader.readAsArrayBuffer(file);
}

function persistLocal() {
  localStorage.setItem(APP_KEY, JSON.stringify({
    data: state.data,
    path: state.rememberedPath,
    seedVersion: SEED_VERSION
  }));
}

function markDirty() {
  state.dirty = true;
  updateDirtyIndicator();
}

function markClean() {
  state.dirty = false;
  state.formDirty = false;
  updateDirtyIndicator();
}

function persistDataChange() {
  persistLocal();
  markDirty();
}

function updateDirtyIndicator() {
  const btn = el("exportPrettyXlsxBtn");
  if (!btn) return;
  const dirty = hasUnsavedChanges();
  btn.textContent = dirty ? "Выгрузка Excel *" : "Выгрузка Excel";
  btn.title = dirty ? "Есть несохранённые изменения — выгрузите Excel" : "";
}

function hasUnsavedChanges() {
  return !!(state.dirty || state.formDirty);
}

function flushEmployeeFormIfNeeded() {
  if (!state.formDirty) return true;
  const dep = getCurrentDept();
  const emp = getEmployeeById(state.selectedEmployeeId);
  if (!emp || !dep) {
    state.formDirty = false;
    return true;
  }
  const next = readEmployeeForm();
  if (!next.fio) {
    toast("ФИО обязательно — сохраните карточку или отмените правки");
    return false;
  }
  Object.assign(emp, next);
  syncDeptHierarchy(dep, { preserveManagers: true });
  state.formDirty = false;
  persistDataChange();
  return true;
}

function getExportExcelFileName() {
  const path = String(state.loadedPath || state.rememberedPath || "").trim();
  const base = path.replace(/\\/g, "/").split("/").pop();
  if (base && /\.xlsx?$/i.test(base)) return base;
  return "structa-org-structure.xlsx";
}

function pathFromPickedFile(file) {
  if (!file) return "";
  if (file.path) return String(file.path);
  return resolveLoadedFilePath(file.name);
}

function saveExcelPathSetting(path) {
  const next = String(path || "").trim();
  if (!next) return;
  state.rememberedPath = next;
  state.loadedPath = next;
  refreshPathDisplay();
  persistLocal();
  status("Путь к Excel сохранён в настройках");
}

/** @returns {boolean} true — можно продолжать действие */
function confirmSaveIfDirty() {
  if (!hasUnsavedChanges()) return true;
  const wantSave = confirm("Вы изменили данные, хотите сохранить?");
  if (!wantSave) return true;
  if (!flushEmployeeFormIfNeeded()) return false;
  exportExcelPretty();
  return true;
}

/** Спросить только про несохранённую карточку сотрудника. */
function confirmDiscardOrSaveForm() {
  if (!state.formDirty) return true;
  const wantSave = confirm("Вы изменили данные, хотите сохранить?");
  if (wantSave) return flushEmployeeFormIfNeeded();
  state.formDirty = false;
  updateDirtyIndicator();
  return true;
}

function restoreLocal() {
  const raw = localStorage.getItem(APP_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.seedVersion !== SEED_VERSION) return false;
    state.data = parsed.data;
    state.rememberedPath = normalizeExcelSettingsPath(parsed.path || "");
    state.loadedPath = "";
    refreshPathDisplay();
    return true;
  } catch { return false; }
}

function normalizeExcelSettingsPath(path) {
  const p = String(path || "").trim();
  if (!p) return "";
  if (/\.json$/i.test(p)) return p.replace(/\.json$/i, ".xlsx");
  if (!/\.xlsx?$/i.test(p)) {
    // path without extension — keep as folder/base and append default file
    if (/[\\/]$/.test(p)) return `${p}structa-org-structure.xlsx`;
    return `${p}.xlsx`;
  }
  return p;
}

function loadVacationSeed() {
  if (window.VACATION_SEED) return structuredClone(window.VACATION_SEED);
  throw new Error("VACATION_SEED не найден");
}

function getRuntimeDataPathHint() {
  if (window.location.protocol === "file:") {
    let p = decodeURIComponent(window.location.pathname || "");
    // Browsers expose file:// paths with forward slashes.
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    p = p.replace(/\//g, "\\");
    const base = p.replace(/[^\\]+$/, "");
    return `${base}structa-org-structure.xlsx`;
  }
  return `${window.location.origin}/structa-org-structure.xlsx`;
}

function resolveLoadedFilePath(fileName) {
  if (!fileName) return "";
  if (window.location.protocol === "file:") {
    let p = decodeURIComponent(window.location.pathname || "");
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    p = p.replace(/\//g, "\\");
    const base = p.replace(/[^\\]+$/, "");
    return `${base}${fileName}`;
  }
  return `${window.location.origin}/${fileName}`;
}

function refreshPathDisplay() {
  el("filePathDisplay").value = state.loadedPath || state.rememberedPath || getRuntimeDataPathHint();
}

function applyVacationSeed() {
  state.data = loadVacationSeed();
  state.selectedDeptId = state.data.companies[0]?.id || null;
  state.selectedEmployeeId = null;
  state.collapsed.clear();
  state.printSelected.clear();
  assignManagersAll({ normalizeTree: true });
  persistLocal();
  markClean();
  renderAll();
}

function downloadJson() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" }));
  a.download = "structa-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
  markClean();
  status("JSON скачан — замените файл в проекте или загрузите этот скачанный файл");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmployeeTree(employees) {
  const map = new Map();
  employees.forEach((e) => map.set(e.id, { emp: e, reports: [] }));
  const roots = [];
  employees.forEach((e) => {
    const node = map.get(e.id);
    const mid = e.managerId;
    if (mid && map.has(mid) && mid !== e.id) map.get(mid).reports.push(node);
    else roots.push(node);
  });
  return sortEmployeeTreeNodes(roots);
}

function renderPrintEmployees(employees, indent) {
  let html = "";
  buildEmployeeTree(employees).forEach((node) => {
    html += renderPrintEmployeeNode(node, indent);
  });
  return html;
}

function renderPrintEmployeeNode(node, indent) {
  const mgr = isManager(node.emp);
  let html = `<div class="print-person${mgr ? " print-person-mgr" : ""}" style="--ind:${indent}">
    <span class="print-fio">${escapeHtml(node.emp.fio)}</span>
    <span class="print-role">${escapeHtml(node.emp.role || "")}</span>
  </div>`;
  node.reports.forEach((r) => {
    html += renderPrintEmployeeNode(r, indent + 1);
  });
  return html;
}

function renderPrintBranch(nodes, depth) {
  let html = "";
  for (const node of nodes) {
    if (state.printSelected.has(node.id)) {
      html += `<div class="print-dept" style="--lvl:${depth}">${escapeHtml(node.name)}</div>`;
      if (node.employees.length) html += `<div class="print-staff">${renderPrintEmployees(node.employees, depth + 1)}</div>`;
      html += renderPrintBranch(node.children || [], depth + 1);
    } else {
      html += renderPrintBranch(node.children || [], depth);
    }
  }
  return html;
}

function printStructurePdf() {
  if (!state.printSelected.size) return toast("Отметьте подразделения ☑ для печати");

  let deptCount = 0, empCount = 0;
  walkDepartments(state.data.companies, (d) => {
    if (state.printSelected.has(d.id)) {
      deptCount += 1;
      empCount += d.employees.length;
    }
  });

  const now = new Date().toLocaleString("ru-RU");
  const body = renderPrintBranch(state.data.companies, 0);
  const root = el("printRoot");

  root.innerHTML = `
    <div class="print-doc">
      <header class="print-header">
        <h1><span class="gold">${APP_NAME}</span> — ${APP_TAGLINE}</h1>
        <p class="print-meta">${now} · отделов ${deptCount} · сотрудников ${empCount}</p>
      </header>
      <section class="print-body">${body}</section>
    </div>`;

  const cleanup = () => {
    root.hidden = true;
    root.innerHTML = "";
    document.body.classList.remove("is-printing");
    window.removeEventListener("afterprint", cleanup);
  };

  root.hidden = false;
  document.body.classList.add("is-printing");
  window.addEventListener("afterprint", cleanup);
  status("Сохранить как PDF");
  window.print();
}

function uploadJson(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed.meta || !Array.isArray(parsed.companies)) throw new Error("Неверный формат");
      state.data = parsed;
      normalizeAllEmployees();
      state.selectedDeptId = parsed.companies[0]?.id || null;
      state.selectedEmployeeId = null;
      state.collapsed.clear();
      state.printSelected.clear();
      state.loadedPath = resolveLoadedFilePath(file.name);
      refreshPathDisplay();
      persistLocal();
      markClean();
      renderAll();
      status("JSON загружен");
    } catch (e) { toast("Ошибка JSON: " + e.message); }
  };
  reader.readAsText(file, "utf-8");
}

function attachEvents() {
  el("employeeSearch").addEventListener("input", onEmployeeSearchInput);

  el("applyPathBtn").onclick = () => {
    el("pathFileInput").click();
  };

  el("pathFileInput").onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (!/\.xlsx?$/i.test(file.name)) {
      toast("Выберите файл Excel (.xlsx)");
      ev.target.value = "";
      return;
    }
    saveExcelPathSetting(pathFromPickedFile(file));
    ev.target.value = "";
  };

  el("exportPrettyXlsxBtn").onclick = () => {
    if (!flushEmployeeFormIfNeeded()) return;
    exportExcelPretty();
  };
  el("importXlsxBtn").onclick = () => {
    if (!requireAuth()) return;
    if (!confirmSaveIfDirty()) return;
    el("fileInput").dataset.mode = "importXlsx";
    el("fileInput").click();
  };
  el("printPdfBtn").onclick = printStructurePdf;

  el("fileInput").onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (ev.target.dataset.mode === "importXlsx") importExcel(file);
    ev.target.value = "";
  };

  el("toggleTreeBtn").onclick = () => toggleTreeExpandAll();

  el("selectAllPrint").onchange = () => {
    if (el("selectAllPrint").checked) allDeptIds().forEach((id) => state.printSelected.add(id));
    else state.printSelected.clear();
    renderTree();
  };

  el("maternityFilterOnly").onchange = () => {
    state.maternityFilterOnly = el("maternityFilterOnly").checked;
    if (state.maternityFilterOnly) {
      buildTreeFilterContext().visibleDeptIds.forEach((id) => expandDeptAncestors(id));
    }
    renderAll();
  };

  el("employmentFilter").onchange = () => {
    state.employmentFilter = el("employmentFilter").value || "";
    if (state.employmentFilter) {
      buildTreeFilterContext().visibleDeptIds.forEach((id) => expandDeptAncestors(id));
    }
    renderAll();
  };

  const formFieldIds = ["fFio", "fRole", "fLevel", "fPhone", "fEmail", "fEmploymentForm", "fPersonType", "fMaternityLeave", "fManager"];
  formFieldIds.forEach((id) => {
    const node = el(id);
    if (!node) return;
    const markForm = () => {
      state.formDirty = true;
      updateDirtyIndicator();
    };
    node.addEventListener("input", markForm);
    node.addEventListener("change", markForm);
  });

  window.addEventListener("beforeunload", (ev) => {
    if (!hasUnsavedChanges()) return;
    ev.preventDefault();
    ev.returnValue = "";
  });

  el("addDeptBtn").onclick = () => {
    if (!requireAuth()) return;
    if (!confirmDiscardOrSaveForm()) return;
    const name = prompt("Название подразделения:");
    if (!name?.trim()) return;
    const dep = { id: uid("dep"), name: name.trim(), children: [], employees: [] };
    const current = getCurrentDept();
    if (current) {
      current.children.push(dep);
      state.collapsed.delete(current.id);
    } else state.data.companies.push(dep);
    state.selectedDeptId = dep.id;
    persistDataChange();
    renderAll();
    toast("Отдел добавлен");
  };

  el("editDeptBtn").onclick = () => {
    if (!requireAuth()) return;
    const dep = getCurrentDept();
    if (!dep) return toast("Сначала выберите отдел в дереве");
    const name = prompt("Новое название:", dep.name);
    if (!name?.trim()) return;
    dep.name = name.trim();
    persistDataChange();
    renderAll();
    toast("Отдел переименован");
  };

  el("deleteDeptBtn").onclick = () => {
    if (!requireAuth()) return;
    const dep = getCurrentDept();
    if (!dep) return toast("Сначала выберите отдел");
    if (!confirm(`Удалить «${dep.name}» со всем содержимым?`)) return;
    removeDepartmentById(dep.id);
    state.selectedDeptId = state.data.companies[0]?.id || null;
    state.selectedEmployeeId = null;
    persistDataChange();
    renderAll();
    toast("Отдел удалён");
  };

  el("addEmpBtn").onclick = () => {
    if (!requireAuth()) return;
    if (!confirmDiscardOrSaveForm()) return;
    const dep = getCurrentDept();
    if (!dep) return toast("Выберите отдел");
    const employee = normalizeEmployeeRecord({
      id: uid("emp"), fio: "Новый сотрудник", role: "Специалист", level: "Middle",
      managerId: null,
      hireDate: new Date().toISOString().slice(0, 10),
      phone: "", email: "", employmentForm: "", personType: "", maternityLeave: false, notes: ""
    });
    dep.employees.push(employee);
    syncAllHierarchy();
    state.selectedEmployeeId = employee.id;
    persistDataChange();
    renderAll();
  };

  el("saveEmpBtn").onclick = () => {
    if (!requireAuth()) return;
    const dep = getCurrentDept();
    const emp = getEmployeeById(state.selectedEmployeeId);
    if (!emp || !dep) return toast("Выберите сотрудника");
    const next = readEmployeeForm();
    if (!next.fio) return toast("ФИО обязательно");
    Object.assign(emp, next);
    syncDeptHierarchy(dep, { preserveManagers: true });
    state.formDirty = false;
    persistDataChange();
    renderAll();
    toast("Сохранено");
  };

  el("deleteEmpBtn").onclick = () => {
    if (!requireAuth()) return;
    const dep = getCurrentDept();
    if (!dep) return;
    const idx = dep.employees.findIndex((e) => e.id === state.selectedEmployeeId);
    if (idx < 0) return toast("Выберите сотрудника");
    dep.employees.splice(idx, 1);
    state.selectedEmployeeId = null;
    state.formDirty = false;
    persistDataChange();
    renderAll();
  };

  el("moveEmpBtn").onclick = () => {
    if (!requireAuth()) return;
    if (!confirmDiscardOrSaveForm()) return;
    const sourceDep = getCurrentDept();
    const emp = getEmployeeById(state.selectedEmployeeId);
    if (!sourceDep || !emp) return toast("Выберите сотрудника");
    const deps = flattenDepartments().filter((d) => d.id !== sourceDep.id);
    const answer = prompt("Номер подразделения:\n" + deps.map((d, i) => `${i + 1}. ${d.path}`).join("\n"));
    const idx = Number(answer) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= deps.length) return;
    const target = findDepartmentById(deps[idx].id);
    sourceDep.employees = sourceDep.employees.filter((e) => e.id !== emp.id);
    target.employees.push(emp);
    syncAllHierarchy();
    state.selectedDeptId = target.id;
    state.selectedEmployeeId = emp.id;
    persistDataChange();
    renderAll();
    toast("Сотрудник перенесён");
  };
}

function createDepartment(name, employees = [], children = []) {
  return { id: uid("dep"), name, employees, children };
}

function createEmployee(i, role, level, alias) {
  const first = ["Иван", "Петр", "Сергей", "Андрей", "Максим", "Антон", "Олег", "Алексей", "Дмитрий", "Николай", "Екатерина", "Марина", "Ольга", "Наталья", "Дарья", "Юлия", "Анна", "Елена"];
  const last = ["Иванов", "Петров", "Сидоров", "Кузнецов", "Смирнов", "Попов", "Лебедев", "Романов", "Федоров", "Козлов", "Волкова", "Зайцева", "Крылова", "Соколова", "Громова"];
  const middle = ["Иванович", "Петрович", "Сергеевич", "Андреевич", "Олегович", "Максимович", "Алексеевич", "Дмитриевич", "Николаевич", "Владимировна", "Андреевна", "Сергеевна", "Игоревна"];
  const y = 2016 + (i % 10), m = String((i % 12) + 1).padStart(2, "0"), d = String((i % 28) + 1).padStart(2, "0");
  return {
    id: uid("emp"),
    fio: `${last[i % last.length]} ${first[i % first.length]} ${middle[i % middle.length]}`,
    role, level: level || ["Junior", "Middle", "Senior"][i % 3],
    hireDate: `${y}-${m}-${d}`,
    phone: `+7 (9${i % 10}${i % 10}) ${100 + (i % 900)}-${10 + (i % 90)}-${10 + (i % 90)}`,
    email: `user${i}@${alias}.local`,
    notes: i % 7 === 0 ? "Ключевой специалист" : "",
    employmentForm: "",
    personType: "",
    maternityLeave: false,
    managerId: null
  };
}

function buildMockData() {
  const hr = createDepartment("Отдел кадров");
  const sales = createDepartment("Коммерческая дирекция");
  const accounting = createDepartment("Бухгалтерия");
  const analytics = createDepartment("Аналитики");
  const support = createDepartment("Техническая поддержка");
  const projectOffice = createDepartment("Проектный офис");

  projectOffice.employees.push(createEmployee(1, "Руководитель проектного офиса", "Head", "virtu"));
  for (let i = 2; i <= 6; i++) projectOffice.employees.push(createEmployee(i, "Project Manager", i === 2 ? "Lead" : "Middle", "virtu"));
  analytics.employees.push(createEmployee(7, "Руководитель аналитиков", "Head", "virtu"));
  for (let i = 8; i <= 16; i++) analytics.employees.push(createEmployee(i, "Системный аналитик", i % 4 === 0 ? "Senior" : "Middle", "virtu"));
  for (let i = 17; i < 29; i++) hr.employees.push(createEmployee(i, "HR-специалист", i % 5 === 0 ? "Senior" : "Middle", "virtu"));
  for (let i = 29; i < 51; i++) sales.employees.push(createEmployee(i, "Менеджер по продажам", i % 6 === 0 ? "Senior" : "Middle", "virtu"));
  for (let i = 51; i < 65; i++) accounting.employees.push(createEmployee(i, "Бухгалтер", i % 7 === 0 ? "Senior" : "Middle", "virtu"));
  for (let i = 65; i < 87; i++) support.employees.push(createEmployee(i, "Инженер техподдержки", i % 3 === 0 ? "Senior" : "Middle", "virtu"));

  const virtusystems = createDepartment("ВИРТУ СИСТЕМС", [], [hr, sales, accounting, projectOffice, analytics, support]);

  const networking = createDepartment("Сети");
  const engDept = createDepartment("Отдел инженеров");
  const cloudOps = createDepartment("Cloud Operations");
  const secOps = createDepartment("Информационная безопасность");
  const monitoring = createDepartment("Мониторинг и NOC");

  for (let i = 87; i < 106; i++) networking.employees.push(createEmployee(i, "Сетевой инженер", i % 4 === 0 ? "Senior" : "Middle", "comcloud"));
  for (let i = 106; i < 136; i++) engDept.employees.push(createEmployee(i, "Системный инженер", i % 5 === 0 ? "Senior" : "Middle", "comcloud"));
  for (let i = 136; i < 160; i++) cloudOps.employees.push(createEmployee(i, "Cloud инженер", i % 5 === 0 ? "Senior" : "Middle", "comcloud"));
  for (let i = 160; i < 172; i++) secOps.employees.push(createEmployee(i, "Инженер ИБ", i % 4 === 0 ? "Senior" : "Middle", "comcloud"));
  for (let i = 172; i < 181; i++) monitoring.employees.push(createEmployee(i, "NOC-инженер", i % 3 === 0 ? "Senior" : "Middle", "comcloud"));

  const comcloud = createDepartment("КОМКЛАУД (Инфраструктура)", [], [networking, engDept, cloudOps, secOps, monitoring]);

  return {
    meta: { name: "StructaData", version: 1, passwordHash: "" },
    companies: [virtusystems, comcloud]
  };
}

function findFirstDeptWithEmployees() {
  let found = null;
  walkDepartments(state.data.companies, (d) => {
    if (!found && d.employees.length) found = d;
  });
  return found;
}

function init() {
  const fromLocal = restoreLocal();
  if (!fromLocal) {
    try {
      state.data = loadVacationSeed();
    } catch {
      state.data = buildMockData();
    }
    assignManagersAll({ normalizeTree: true });
  }
  normalizeAllEmployees();
  if (!state.rememberedPath) state.rememberedPath = getRuntimeDataPathHint();
  else state.rememberedPath = normalizeExcelSettingsPath(state.rememberedPath);
  refreshPathDisplay();
  const firstDept = findFirstDeptWithEmployees();
  if (!state.selectedDeptId || !findDepartmentById(state.selectedDeptId)?.employees?.length) {
    state.selectedDeptId = firstDept?.id || state.data.companies[0]?.id || null;
  }
  if (state.selectedDeptId && !state.selectedEmployeeId) {
    const dep = findDepartmentById(state.selectedDeptId);
    state.selectedEmployeeId = dep?.employees?.[0]?.id || null;
  }
  if (state.selectedDeptId) expandDeptAncestors(state.selectedDeptId);
  attachEvents();
  bindAuthGuard();
  updateAuthUI();
  renderAll();
  const s = collectStats();
  status(`${state.data.meta.source || APP_NAME} · ${s.empCount} сотр.`);
  persistLocal();
  markClean();
}

init();
