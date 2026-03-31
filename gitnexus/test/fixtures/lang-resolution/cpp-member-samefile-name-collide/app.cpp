// Same TU: local class has SetIPAndPort(1); call t.SetIPAndPort(4 args) on TZmdbMgrServiceComm.
class TZmdbMgrServiceComm {
public:
    void SetIPAndPort(const char *a, int b, const char *c, int d);
};

class TZmdbMigration {
public:
    void SetIPAndPort(int x);
};

void TZmdbMgrServiceComm::SetIPAndPort(const char *a, int b, const char *c, int d) {
    (void)a;
    (void)b;
    (void)c;
    (void)d;
}

void TZmdbMigration::SetIPAndPort(int x) {
    (void)x;
    TZmdbMgrServiceComm t;
    t.SetIPAndPort(nullptr, 0, nullptr, 0);
}
