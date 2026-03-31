#pragma once

class TZmdbMgrServiceComm {
public:
    void SetIPAndPort(const char *a, int b, const char *c, int d);
    bool ConnectMgr(const char *dsn, const char *uid, const char *pwd, bool b);
    int PrintMgrLinkInfo();
};
