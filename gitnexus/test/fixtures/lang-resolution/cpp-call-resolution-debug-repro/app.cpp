#include "mgr.h"

#define COMM_TYPE TZmdbMgrServiceComm

void PrintMgrLinkInfo()
{
    COMM_TYPE tMgrServiceComm;
    tMgrServiceComm.SetIPAndPort(0, 0, 0, 0);
    tMgrServiceComm.ConnectMgr("a", "b", "c", true);
    tMgrServiceComm.PrintMgrLinkInfo();
}
