## 与 https://github.com/abhigyanpatwari/GitNexus 差异内容分析:

### 后台服务

#### gitnexus/scripts
1. gitnexus下载仓库后, 自动转换所有字符集到UTF8

#### 


1、gitnexus支持对接公司git
2、gitnexus优化C++函数调用关系：相同函数名称并且文件有引用关系的才存在调用关系
3、gitnexus serve支持API，一键下载并分析代码，代码放在环境变量HOME或服务启动路径下，目录名称为ginexus_code，当代码已存在(registry.json)中存在，就禁止重复下载代码。分析的进度要能返回给客户端。
4、gitnexus web支持server模式选填仓库名称，避免多仓库时，无法指定仓库访问
5、gitnexus web支持默认server访问模式，通过url中的参数控制默认server访问，参数中指定服务地址和仓库名
6、server也要支持cypher query -- 传递后端查询，以及大模型能力
7、gitnexus下载仓库后，要自动转换所有字符集到UTF8
8、c++ class/struct的调用应要匹配到对应的.h/.cpp文件中
9、"文件和文件关系准确性：不准确
  --a、ZmdbWebMonitor.h：被5个文件包含，实际查询出来只有一个文件，问题可能如下：
	#include ""ZmdbWebMonitor.h""   ---未查询到
	#include ""Helper/ZmdbCCryptDES.h""   ---正常查询到"
10、部分Function缺失：const char* GetRunningState(TZmdbMgrServiceComm *pServiceComm, const char* pszDsn)"
11、类的构造函数识别为Function--构造函数在.h中实现，识别为Function
12、"GitNexus的Cypher Query的examples，增加如下内容：
1)、展示项目的所有目录、文件、类信息：MATCH (n:`Folder`) RETURN n.id AS id, n.name AS name, n.filePath AS path
2)、按照目录展示对应的源文件：MATCH (f:File) WHERE f.filePath STARTS WITH 'WebMonitor/' RETURN f.name
3)、按照文件展示其包含的method和fun：MATCH (c:Class) WHERE c.filePath CONTAINS '文件名' RETURN c.name/MATCH (f:Function) WHERE f.filePath CONTAINS '文件名' RETURN f.name/MATCH (m:Method) WHERE m.filePath CONTAINS '文件名' RETURN m.name/MATCH (c:struct) WHERE c.filePath CONTAINS '文件名' RETURN c.name
4)、给定一个文件名，查询被哪些文件IMPORT: MATCH (s)-[r:CodeRelation {type: 'IMPORTS'}]->(t) WHERE t.name = 'ZmdbWebMonitor.h' RETURN s.name
5)、给定一个文件名，查询IMPORT了哪些文件：MATCH (s)-[r:CodeRelation {type: 'IMPORTS'}]->(t) WHERE s.name = 'mdbWebMonitor.cpp' RETURN t.name
6)、给定一个文件名，查询包含的macro:MATCH (n) WHERE n.id STARTS WITH 'Macro:' AND n.filePath CONTAINS '文件名' RETURN n.name
7)、给定一个符号，查看其入方向的所有关系：npx gitnexus cypher --repo Zmdb ""MATCH (n)-[r]->(m) WHERE n.name = 'CZmdbMasterSignalThread' RETURN r.type AS relation, m.name AS target""
8)、给定一个符号，查看其出方向的所有关系：npx gitnexus cypher --repo Zmdb ""MATCH (m)-[r]->(n) WHERE n.name = 'CZmdbMasterSignalThread' RETURN r.type AS relation, m.name AS source"""
13、gitnexus本地git支持分析，向量化模型采用国内镜像源，并输出部署使用手册
14、zip上传支持向量化
15、zip上传支持持久化
16、支持获取模型列表
17、默认关闭layout optimizing
18、支持拉分支
19、"支持根据分支来检索是否已创建：
1)、主分支时，保存目录名称和仓库名称一致
2)、非主分支时，保存目录名称=仓库名称_分支名称
3)、zip上传时，保存目录名称=文件名_zip"wei
20、支持数据大于50条时进行分页查询
21、搜索节点时支持自动聚焦，并修复聚焦按钮的可用性
22、[未实现]cypher query支持自定义，持久化，比如用户执行了一个查询，支持根据各自浏览器使用定制自己的查询接口
23、[未实现]大模型递归次数可配置
24、重复克隆要自动跳转到server模式
25、1.4版本文件占用无法删除问题：数据库连接未关闭
26、"分析进度展示优化：
1)、克隆时百分比来回跳
2)、分析中和正在分析代码阶段来回跳
3)、正在分析代码不显示文件处理情况
4)、向量化阶段太晚"