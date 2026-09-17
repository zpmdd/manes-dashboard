import vehicles from './daoyan-vehicles.json' with { type: 'json' };

const preset = {
  "version": 2,
  "brand": "MANES",
  "title": "全域运行监测中心",
  "mapTitle": "区域运行态势",
  "navLabels": [
    "运行总览",
    "数据监测",
    "交通网络",
    "区域管理"
  ],
  "showClock": true,
  "canvas": {
    "snap": true,
    "grid": 1,
    "magnet": true,
    "threshold": 6
  },
  "map": {
    "layout": {
      "x": 20,
      "y": 0,
      "w": 80,
      "h": 100
    },
    "visible": true,
    "locked": false,
    "vehicleSourceId": "ds_daoyan_vehicles"
  },
  "projectId": "daoyan",
  "modules": [
    {
      "id": "devices",
      "title": "车辆总数",
      "subtitle": "GPS 快照 · 2026/09/13 00:00",
      "type": "metric",
      "source": "devices",
      "visible": true,
      "unit": "辆",
      "rowCount": 5,
      "columns": [
        {
          "key": "name",
          "label": "区域"
        },
        {
          "key": "value",
          "label": "接入设备"
        },
        {
          "key": "status",
          "label": "状态"
        }
      ],
      "layout": {
        "x": 0,
        "y": 0,
        "w": 19,
        "h": 32
      },
      "locked": false,
      "surface": "glass",
      "binding": {
        "sourceId": "ds_daoyan_vehicles",
        "fields": {
          "name": "name",
          "value": "count",
          "time": "GPS_DATE",
          "status": "status",
          "target": "target",
          "series": "series",
          "code": "code",
          "x": "x",
          "y": "y",
          "value2": "value2"
        }
      },
      "aggregate": "sum",
      "text": "",
      "target": 100,
      "precision": 0,
      "chartOptions": {
        "legend": true,
        "labels": false,
        "zoom": false,
        "smooth": true,
        "palette": "champagne",
        "secondaryUnit": "",
        "primaryName": "主指标",
        "secondaryName": "辅助指标",
        "xName": "",
        "yName": ""
      }
    },
    {
      "id": "online",
      "title": "行驶与静止",
      "subtitle": "按 GPS 速度划分 · 点击图例联动",
      "type": "donut",
      "source": "regions",
      "visible": true,
      "unit": "辆",
      "rowCount": 5,
      "columns": [
        {
          "key": "name",
          "label": "区域"
        },
        {
          "key": "value",
          "label": "接入设备"
        },
        {
          "key": "status",
          "label": "状态"
        }
      ],
      "layout": {
        "x": 0,
        "y": 34,
        "w": 19,
        "h": 32
      },
      "locked": false,
      "surface": "glass",
      "binding": {
        "sourceId": "ds_daoyan_vehicles",
        "fields": {
          "name": "status",
          "value": "count",
          "code": "stateCode"
        },
        "groupBy": "name"
      },
      "aggregate": "sum",
      "text": "",
      "target": 100,
      "precision": 0,
      "chartOptions": {
        "legend": true,
        "labels": false,
        "zoom": false,
        "smooth": true,
        "palette": "champagne",
        "secondaryUnit": "",
        "primaryName": "主指标",
        "secondaryName": "辅助指标",
        "xName": "",
        "yName": ""
      }
    },
    {
      "id": "trend",
      "title": "各车 GPS 速度",
      "subtitle": "原始速度值 · 点击车辆定位",
      "type": "bar",
      "source": "regions",
      "visible": true,
      "unit": "",
      "rowCount": 8,
      "columns": [
        {
          "key": "name",
          "label": "区域"
        },
        {
          "key": "value",
          "label": "接入设备"
        },
        {
          "key": "status",
          "label": "状态"
        }
      ],
      "layout": {
        "x": 0,
        "y": 68,
        "w": 19,
        "h": 32
      },
      "locked": false,
      "surface": "solid",
      "binding": {
        "sourceId": "ds_daoyan_vehicles",
        "fields": {
          "name": "name",
          "value": "GPS_SPEED",
          "time": "GPS_DATE",
          "status": "status",
          "target": "target",
          "series": "series",
          "code": "code",
          "x": "x",
          "y": "y",
          "value2": "value2"
        }
      },
      "aggregate": "sum",
      "text": "",
      "target": 100,
      "precision": 0,
      "chartOptions": {
        "legend": true,
        "labels": false,
        "zoom": false,
        "smooth": true,
        "palette": "champagne",
        "secondaryUnit": "",
        "primaryName": "主指标",
        "secondaryName": "辅助指标",
        "xName": "",
        "yName": ""
      }
    }
  ]
};
preset.dataSources = [{ ...{"id": "ds_daoyan_vehicles", "name": "车辆定位快照", "type": "json", "url": "", "rowsPath": "", "refreshSeconds": 0}, content: JSON.stringify(vehicles) }];

export default { id: 'daoyan', name: '道研版', showBrand: false, vehicles: true, preset };
